# Portabilidad — Acceso operativo del rol Personal

> Estado: documentado para migración futura al backend propio.  
> El backend propio no está implementado todavía. Este documento describe las
> reglas que deben trasladarse cuando se realice la migración.

---

## Contexto

El CRM actualmente usa Supabase con RLS (Row Level Security) en PostgreSQL para
controlar el acceso por rol. Cuando se migre a una base de datos propia, estas
reglas deben reimplementarse en la capa de acceso a datos del nuevo backend.

---

## Roles del sistema

| Rol            | Descripción                                          |
|----------------|------------------------------------------------------|
| `Administrador`| Acceso completo a todos los módulos y operaciones    |
| `Personal`     | Acceso de lectura a módulos operativos; sin pagos ni configuración |

El rol se almacena en `profiles.role` y el estado activo en `profiles.status = 'Activo'`.

---

## Reglas de acceso por tabla

### `clients` (Clientes)

| Operación | Administrador | Personal |
|-----------|:---:|:---:|
| SELECT    | ✅  | ✅  |
| INSERT    | ✅  | ❌  |
| UPDATE    | ✅  | ❌  |
| DELETE    | ✅  | ❌  |

### `cases` (Expedientes)

| Operación | Administrador | Personal |
|-----------|:---:|:---:|
| SELECT    | ✅  | ✅  |
| INSERT    | ✅  | ❌  |
| UPDATE    | ✅  | ❌  |
| DELETE    | ✅  | ❌  |

### `case_tasks` (Tareas)

| Operación | Administrador | Personal |
|-----------|:---:|:---:|
| SELECT    | ✅  | ✅ (disponibles + propias) |
| INSERT (crear tarea)   | ✅  | ❌  |
| UPDATE (propia tarea)  | ✅  | ✅ (solo estado y observaciones) |
| UPDATE (otras tareas)  | ✅  | ❌  |
| DELETE    | ✅  | ❌  |
| RPC `claim_case_task`  | ✅  | ✅  |
| RPC `return_case_task` | ✅  | ✅ (solo la propia) |

**Restricciones adicionales de `case_tasks` para Personal:**
- No puede cambiar `assigned_to` a otro usuario.
- No puede cambiar `client_id`, `case_id` ni campos administrativos.
- Solo puede modificar `status`, `description` y `priority` de sus propias tareas.
- El trigger `guard_case_task_update` aplica estas restricciones en el servidor.

### `documents` (Documentos)

| Operación | Administrador | Personal |
|-----------|:---:|:---:|
| SELECT    | ✅  | ✅  |
| INSERT    | ✅  | ✅ (puede subir documentos) |
| UPDATE    | ✅  | ✅ (metadatos propios) |
| DELETE    | ✅  | ❌  |

### `document_folders` (Carpetas de documentos)

| Operación | Administrador | Personal |
|-----------|:---:|:---:|
| SELECT    | ✅  | ✅  |
| INSERT    | ✅  | ❌  |
| UPDATE    | ✅  | ❌  |
| DELETE    | ✅  | ❌  |

### `client_reports` (Reportes)

| Operación | Administrador | Personal |
|-----------|:---:|:---:|
| SELECT    | ✅  | ✅  |
| INSERT    | ✅  | ✅ (como autor) |
| UPDATE    | ✅  | ✅ (solo propios) |
| DELETE    | ✅  | ✅ (solo propios) |

### `agenda_events` (Agenda)

| Operación | Administrador | Personal |
|-----------|:---:|:---:|
| SELECT    | ✅  | ✅  |
| INSERT    | ✅  | ❌  |
| UPDATE    | ✅  | ❌  |
| DELETE    | ✅  | ❌  |

### `payments` / `payment_records` (Pagos)

| Operación | Administrador | Personal |
|-----------|:---:|:---:|
| SELECT    | ✅  | ❌  |
| INSERT    | ✅  | ❌  |
| UPDATE    | ✅  | ❌  |
| DELETE    | ✅  | ❌  |

---

## Dependencias de Supabase a trasladar

Al migrar al backend propio, las siguientes dependencias de Supabase deben
reimplementarse:

### 1. `auth.uid()`

Actualmente la identidad del usuario se obtiene con `auth.uid()` en las
políticas RLS. En el backend propio, esto debe obtenerse del token JWT o
sesión de la capa de autenticación propia.

**Equivalencia sugerida:**
```ts
// Middleware de autenticación propio
function getCurrentUserId(request: Request): string | null {
  // Extraer userId del token JWT validado
  return request.auth?.userId ?? null;
}
```

### 2. `profiles`

El rol y estado del usuario se consultan en `public.profiles`:

```sql
SELECT role, status FROM profiles WHERE id = auth.uid()
```

**Equivalencia sugerida:** tabla `users` en el backend propio con campos
`role: 'Administrador' | 'Personal'` y `status: 'Activo' | 'Inactivo'`.

### 3. `is_admin()` y `is_staff()`

Funciones SQL auxiliares que se deben reemplazar por middleware o helpers
en el backend:

```ts
function isAdmin(user: User): boolean {
  return user.role === 'Administrador' && user.status === 'Activo';
}

function isStaff(user: User): boolean {
  return (user.role === 'Administrador' || user.role === 'Personal')
    && user.status === 'Activo';
}
```

### 4. RPCs `claim_case_task` y `return_case_task`

Funciones atómicas que garantizan que dos usuarios no tomen la misma tarea.
En el backend propio se deben implementar con transacciones:

```ts
// claim_case_task — equivalencia
async function claimTask(taskId: string, userId: string): Promise<Task> {
  return await db.transaction(async (tx) => {
    const task = await tx.tasks.findFirst({
      where: { id: taskId, assigned_to: null, status: 'pending' },
      lock: 'FOR UPDATE'
    });
    if (!task) throw new Error('Tarea no disponible o ya tomada');
    return tx.tasks.update({
      where: { id: taskId },
      data: {
        assigned_to: userId,
        claimed_by: userId,
        claimed_at: new Date().toISOString(),
        status: 'in_progress'
      }
    });
  });
}
```

### 5. `guard_case_task_update` (trigger)

Este trigger PostgreSQL previene que Personal modifique campos administrativos
de una tarea. En el backend propio se debe implementar como validación en la
capa de servicio:

```ts
async function updateTask(taskId: string, updates: TaskUpdate, userId: string, userRole: string) {
  if (isAdmin({ role: userRole, status: 'Activo' })) {
    // Admin puede actualizar cualquier campo
    return db.tasks.update({ where: { id: taskId }, data: updates });
  }

  // Personal solo puede actualizar sus propias tareas
  const task = await db.tasks.findFirst({ where: { id: taskId, assigned_to: userId } });
  if (!task) throw new Error('Sin permiso para modificar esta tarea');

  // Personal no puede cambiar campos administrativos
  const allowedFields = ['status', 'description', 'priority'];
  const forbidden = Object.keys(updates).filter(k => !allowedFields.includes(k));
  if (forbidden.length > 0) {
    throw new Error(`Campo(s) no permitido(s): ${forbidden.join(', ')}`);
  }

  return db.tasks.update({ where: { id: taskId }, data: updates });
}
```

---

## Lógica frontend que no depende de Supabase

El frontend implementa permisos en `src/lib/permissions.ts`. Esta capa es
**completamente portátil** y no depende de Supabase. Solo necesita recibir
el rol del usuario autenticado:

```ts
// Funciona igual con cualquier backend de autenticación
const permissions = usePermissions(profile);

// Controla navegación, botones y queries en el cliente
const { canViewClients, canCreateTasks, canViewPayments } = permissions;
```

Los únicos cambios necesarios en el frontend al migrar serían:

1. **`useAuth`**: cambiar `supabase.auth.onAuthStateChange` por el equivalente
   del nuevo backend de autenticación.
2. **`getAuthClient`**: reemplazar el cliente Supabase por el cliente HTTP propio.
3. **Hooks de datos**: reemplazar `db.from('table').select(...)` por llamadas
   al API REST propio.

La lógica de permisos, navegación, guards de rutas y componentes no necesita
cambios.

---

## Resumen de portabilidad

| Capa | Dependencia Supabase | Portabilidad |
|------|---------------------|:---:|
| Permisos frontend (`permissions.ts`) | Ninguna | ✅ Completamente portable |
| Navegación / Guards | Ninguna | ✅ Completamente portable |
| Hooks de datos | `getAuthClient` + tablas | ⚠️ Requiere adaptar llamadas API |
| Autenticación (`use-auth.tsx`) | `supabase.auth` | ⚠️ Requiere adaptar al nuevo auth |
| RLS políticas | PostgreSQL + Supabase | ❌ Requiere reimplementar en backend |
| RPCs (`claim_case_task`, etc.) | PostgreSQL functions | ❌ Requiere reimplementar como endpoints |
| Triggers (`guard_case_task_update`) | PostgreSQL triggers | ❌ Requiere reimplementar en capa de servicio |
| Storage de documentos | Supabase Storage | ❌ Requiere migrar a nuevo storage |

---

*Generado: 2026-07-30. No implementar el backend propio todavía.*
