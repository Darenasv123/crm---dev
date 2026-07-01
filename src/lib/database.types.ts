export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          phone: string | null;
          role: "Administrador" | "Personal";
          status: "Activo" | "Inactivo";
          initials: string;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          email: string;
          phone?: string | null;
          role?: "Administrador" | "Personal";
          status?: "Activo" | "Inactivo";
          initials: string;
          created_at?: string;
        };
        Update: {
          full_name?: string;
          email?: string;
          phone?: string | null;
          role?: "Administrador" | "Personal";
          status?: "Activo" | "Inactivo";
          initials?: string;
        };
      };
      clients: {
        Row: {
          id: string;
          name: string;
          initials: string;
          color: string;
          dni: string;
          phone: string;
          email: string | null;
          address: string | null;
          birthdate: string | null;
          civil_status: string | null;
          process_type: string;
          status: "Activo" | "En espera" | "Cerrado";
          registered_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          initials?: string;
          color?: string;
          dni: string;
          phone: string;
          email?: string | null;
          address?: string | null;
          birthdate?: string | null;
          civil_status?: string | null;
          process_type: string;
          status?: "Activo" | "En espera" | "Cerrado";
          registered_at?: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          initials?: string;
          color?: string;
          dni?: string;
          phone?: string;
          email?: string | null;
          address?: string | null;
          birthdate?: string | null;
          civil_status?: string | null;
          process_type?: string;
          status?: "Activo" | "En espera" | "Cerrado";
        };
      };
      cases: {
        Row: {
          id: string;
          client_id: string;
          expediente: string;
          process_type: string;
          priority: "Alta" | "Media" | "Baja";
          next_hearing: string | null;
          status: "Consulta" | "Documentación" | "Demanda presentada" | "En proceso" | "Audiencia" | "Sentencia" | "Archivado";
          juzgado: string;
          demandante: string | null;
          demandado: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          expediente: string;
          process_type: string;
          priority?: "Alta" | "Media" | "Baja";
          next_hearing?: string | null;
          status?: "Consulta" | "Documentación" | "Demanda presentada" | "En proceso" | "Audiencia" | "Sentencia" | "Archivado";
          juzgado: string;
          demandante?: string | null;
          demandado?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          expediente?: string;
          process_type?: string;
          priority?: "Alta" | "Media" | "Baja";
          next_hearing?: string | null;
          status?: "Consulta" | "Documentación" | "Demanda presentada" | "En proceso" | "Audiencia" | "Sentencia" | "Archivado";
          juzgado?: string;
          demandante?: string | null;
          demandado?: string | null;
          notes?: string | null;
        };
      };
      payments: {
        Row: {
          id: string;
          client_id: string;
          service: string;
          fees: number;
          paid: number;
          total_installments: number;
          paid_installments: number;
          status: "Pagado" | "Parcial" | "Pendiente" | "Vencido";
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          service: string;
          fees: number;
          paid?: number;
          total_installments?: number;
          paid_installments?: number;
          status?: "Pagado" | "Parcial" | "Pendiente" | "Vencido";
          created_at?: string;
        };
        Update: {
          service?: string;
          fees?: number;
          paid?: number;
          total_installments?: number;
          paid_installments?: number;
          status?: "Pagado" | "Parcial" | "Pendiente" | "Vencido";
        };
      };
      payment_records: {
        Row: {
          id: string;
          payment_id: string;
          amount: number;
          method: string;
          receipt: string | null;
          notes: string | null;
          payment_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          payment_id: string;
          amount: number;
          method: string;
          receipt?: string | null;
          notes?: string | null;
          payment_date?: string;
          created_at?: string;
        };
        Update: {
          amount?: number;
          method?: string;
          receipt?: string | null;
          notes?: string | null;
        };
      };
      agenda_events: {
        Row: {
          id: string;
          title: string;
          type: "Audiencia" | "Cita" | "Recordatorio";
          event_date: string;
          event_time: string;
          location: string | null;
          client_id: string | null;
          gcal_event_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          type: "Audiencia" | "Cita" | "Recordatorio";
          event_date: string;
          event_time: string;
          location?: string | null;
          client_id?: string | null;
          gcal_event_id?: string | null;
          created_at?: string;
        };
        Update: {
          title?: string;
          type?: "Audiencia" | "Cita" | "Recordatorio";
          event_date?: string;
          event_time?: string;
          location?: string | null;
          client_id?: string | null;
          gcal_event_id?: string | null;
        };
      };
      documents: {
        Row: {
          id: string;
          name: string;
          type: string;
          size: string;
          storage_path: string;
          client_id: string | null;
          case_id: string | null;
          uploaded_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          type: string;
          size: string;
          storage_path: string;
          client_id?: string | null;
          case_id?: string | null;
          uploaded_at?: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          type?: string;
          size?: string;
          storage_path?: string;
          client_id?: string | null;
          case_id?: string | null;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
