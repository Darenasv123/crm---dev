export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type VerificationStatus = "pending" | "approved" | "edited" | "rejected" | "conflict";
type LegalTable<Row, RequiredInsert extends keyof Row> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, RequiredInsert>;
  Update: Partial<Row>;
  Relationships: [];
};

type CasePartyRow = {
  id: string;
  case_id: string;
  client_id: string | null;
  full_name: string;
  document_type: string | null;
  document_number: string | null;
  role: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_minor: boolean;
  birth_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

type DocumentExtractionRow = {
  id: string;
  document_id: string;
  extraction_method: string;
  raw_text: string | null;
  structured_data: Json;
  language: string | null;
  page_count: number | null;
  ocr_used: boolean;
  model_name: string | null;
  processing_duration_ms: number | null;
  confidence_score: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

type CaseEventRow = {
  id: string;
  case_id: string;
  document_id: string | null;
  event_type: string;
  title: string;
  description: string | null;
  event_date: string;
  source_page: number | null;
  source_excerpt: string | null;
  confidence_score: number | null;
  verification_status: VerificationStatus;
  created_by_ai: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
};

type CaseTaskRow = {
  id: string;
  case_id: string;
  client_id: string | null;
  title: string;
  description: string | null;
  priority: "Alta" | "Media" | "Baja";
  status: "pending" | "in_progress" | "completed" | "cancelled" | "overdue";
  due_date: string | null;
  assigned_to: string | null;
  source: string;
  created_by_ai: boolean;
  verification_status: VerificationStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

type ImportJobRow = {
  id: string;
  name: string;
  provider: string;
  source_folder_id: string | null;
  source_folder_url: string | null;
  status:
    | "draft"
    | "inventory"
    | "processing"
    | "consolidating"
    | "review_required"
    | "completed"
    | "partially_completed"
    | "failed"
    | "cancelled";
  total_folders: number;
  total_documents: number;
  processed_documents: number;
  failed_documents: number;
  detected_clients: number;
  detected_cases: number;
  progress_percentage: number;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  configuration: Json;
};

type ImportFolderRow = {
  id: string;
  import_job_id: string;
  external_folder_id: string;
  parent_external_folder_id: string | null;
  folder_name: string;
  folder_path: string;
  detected_client_id: string | null;
  detected_case_id: string | null;
  analysis_status: string;
  confidence_score: number | null;
  analysis_summary: string | null;
  created_at: string;
  updated_at: string;
};

type AiAnalysisRunRow = {
  id: string;
  import_job_id: string | null;
  document_id: string | null;
  case_id: string | null;
  analysis_type: string;
  model_provider: string;
  model_name: string;
  prompt_version: string;
  input_reference: string | null;
  output_data: Json;
  confidence_score: number | null;
  status: string;
  error_message: string | null;
  token_usage: Json | null;
  estimated_cost: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
};

type AiFindingRow = {
  id: string;
  analysis_run_id: string;
  client_id: string | null;
  case_id: string | null;
  document_id: string | null;
  finding_type: string;
  field_name: string;
  proposed_value: Json | null;
  normalized_value: Json | null;
  confidence_score: number | null;
  source_page: number | null;
  source_excerpt: string | null;
  verification_status: VerificationStatus;
  review_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

type SourceReferenceRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  document_id: string | null;
  source_page: number | null;
  source_excerpt: string | null;
  confidence_score: number | null;
  created_at: string;
  created_by: string | null;
};

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
        Relationships: [];
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
          document_type: string;
          document_number: string | null;
          whatsapp: string | null;
          occupation: string | null;
          notes: string | null;
          process_type: string;
          status: "Activo" | "En espera" | "Cerrado";
          registered_at: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
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
          document_type?: string;
          document_number?: string | null;
          whatsapp?: string | null;
          occupation?: string | null;
          notes?: string | null;
          process_type: string;
          status?: "Activo" | "En espera" | "Cerrado";
          registered_at?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
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
          document_type?: string;
          document_number?: string | null;
          whatsapp?: string | null;
          occupation?: string | null;
          notes?: string | null;
          process_type?: string;
          status?: "Activo" | "En espera" | "Cerrado";
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      cases: {
        Row: {
          id: string;
          client_id: string;
          expediente: string;
          process_type: string;
          priority: "Alta" | "Media" | "Baja";
          next_hearing: string | null;
          status:
            | "Consulta"
            | "Documentación"
            | "Demanda presentada"
            | "En proceso"
            | "Audiencia"
            | "Sentencia"
            | "Archivado";
          juzgado: string;
          demandante: string | null;
          demandado: string | null;
          notes: string | null;
          internal_code: string | null;
          case_name: string | null;
          case_type: string | null;
          legal_area: string | null;
          case_stage: string | null;
          court: string | null;
          judicial_district: string | null;
          case_number: string | null;
          case_year: number | null;
          judge_or_prosecutor: string | null;
          filing_date: string | null;
          closing_date: string | null;
          current_summary: string | null;
          current_status_description: string | null;
          last_action_date: string | null;
          next_action: string | null;
          responsible_user_id: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          expediente: string;
          process_type: string;
          priority?: "Alta" | "Media" | "Baja";
          next_hearing?: string | null;
          status?:
            | "Consulta"
            | "Documentación"
            | "Demanda presentada"
            | "En proceso"
            | "Audiencia"
            | "Sentencia"
            | "Archivado";
          juzgado: string;
          demandante?: string | null;
          demandado?: string | null;
          notes?: string | null;
          internal_code?: string | null;
          case_name?: string | null;
          case_type?: string | null;
          legal_area?: string | null;
          case_stage?: string | null;
          court?: string | null;
          judicial_district?: string | null;
          case_number?: string | null;
          case_year?: number | null;
          judge_or_prosecutor?: string | null;
          filing_date?: string | null;
          closing_date?: string | null;
          current_summary?: string | null;
          current_status_description?: string | null;
          last_action_date?: string | null;
          next_action?: string | null;
          responsible_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          expediente?: string;
          process_type?: string;
          priority?: "Alta" | "Media" | "Baja";
          next_hearing?: string | null;
          status?:
            | "Consulta"
            | "Documentación"
            | "Demanda presentada"
            | "En proceso"
            | "Audiencia"
            | "Sentencia"
            | "Archivado";
          juzgado?: string;
          demandante?: string | null;
          demandado?: string | null;
          notes?: string | null;
          internal_code?: string | null;
          case_name?: string | null;
          case_type?: string | null;
          legal_area?: string | null;
          case_stage?: string | null;
          court?: string | null;
          judicial_district?: string | null;
          case_number?: string | null;
          case_year?: number | null;
          judge_or_prosecutor?: string | null;
          filing_date?: string | null;
          closing_date?: string | null;
          current_summary?: string | null;
          current_status_description?: string | null;
          last_action_date?: string | null;
          next_action?: string | null;
          responsible_user_id?: string | null;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          client_id: string;
          case_id: string | null;
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
          case_id?: string | null;
          service: string;
          fees: number;
          paid?: number;
          total_installments?: number;
          paid_installments?: number;
          status?: "Pagado" | "Parcial" | "Pendiente" | "Vencido";
          created_at?: string;
        };
        Update: {
          case_id?: string | null;
          service?: string;
          fees?: number;
          paid?: number;
          total_installments?: number;
          paid_installments?: number;
          status?: "Pagado" | "Parcial" | "Pendiente" | "Vencido";
        };
        Relationships: [];
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
        Relationships: [];
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
          case_id: string | null;
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
          case_id?: string | null;
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
          case_id?: string | null;
          gcal_event_id?: string | null;
        };
        Relationships: [];
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
          original_name: string | null;
          display_name: string | null;
          document_type: string | null;
          mime_type: string | null;
          source_type: string;
          source_provider: string | null;
          external_file_id: string | null;
          external_folder_id: string | null;
          external_url: string | null;
          document_date: string | null;
          file_size: number | null;
          checksum: string | null;
          processing_status: string;
          verification_status: string;
          is_confidential: boolean;
          updated_at: string;
          created_by: string | null;
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
          original_name?: string | null;
          display_name?: string | null;
          document_type?: string | null;
          mime_type?: string | null;
          source_type?: string;
          source_provider?: string | null;
          external_file_id?: string | null;
          external_folder_id?: string | null;
          external_url?: string | null;
          document_date?: string | null;
          file_size?: number | null;
          checksum?: string | null;
          processing_status?: string;
          verification_status?: string;
          is_confidential?: boolean;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          type?: string;
          size?: string;
          storage_path?: string;
          client_id?: string | null;
          case_id?: string | null;
          original_name?: string | null;
          display_name?: string | null;
          document_type?: string | null;
          mime_type?: string | null;
          source_type?: string;
          source_provider?: string | null;
          external_file_id?: string | null;
          external_folder_id?: string | null;
          external_url?: string | null;
          document_date?: string | null;
          file_size?: number | null;
          checksum?: string | null;
          processing_status?: string;
          verification_status?: string;
          is_confidential?: boolean;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      client_reports: {
        Row: {
          id: string;
          client_id: string;
          case_id: string | null;
          author_id: string | null;
          category: "Reporte" | "Noticia" | "Seguimiento" | "Alerta" | "Estado" | "Observacion";
          title: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          case_id?: string | null;
          author_id?: string | null;
          category?: "Reporte" | "Noticia" | "Seguimiento" | "Alerta" | "Estado" | "Observacion";
          title: string;
          body: string;
          created_at?: string;
        };
        Update: {
          client_id?: string;
          case_id?: string | null;
          author_id?: string | null;
          category?: "Reporte" | "Noticia" | "Seguimiento" | "Alerta" | "Estado" | "Observacion";
          title?: string;
          body?: string;
        };
        Relationships: [];
      };
      case_parties: LegalTable<CasePartyRow, "case_id" | "full_name" | "role">;
      document_extractions: LegalTable<DocumentExtractionRow, "document_id" | "extraction_method">;
      case_events: LegalTable<CaseEventRow, "case_id" | "event_type" | "title" | "event_date">;
      case_tasks: LegalTable<CaseTaskRow, "case_id" | "title">;
      import_jobs: LegalTable<ImportJobRow, "name">;
      import_folders: LegalTable<
        ImportFolderRow,
        "import_job_id" | "external_folder_id" | "folder_name" | "folder_path"
      >;
      ai_analysis_runs: LegalTable<
        AiAnalysisRunRow,
        "analysis_type" | "model_provider" | "model_name" | "prompt_version"
      >;
      ai_findings: LegalTable<AiFindingRow, "analysis_run_id" | "finding_type" | "field_name">;
      source_references: LegalTable<SourceReferenceRow, "entity_type" | "entity_id" | "field_name">;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
