export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      agenda_events: {
        Row: {
          case_id: string | null;
          client_id: string | null;
          created_at: string;
          event_date: string;
          event_time: string;
          gcal_event_id: string | null;
          id: string;
          location: string | null;
          title: string;
          type: string;
        };
        Insert: {
          case_id?: string | null;
          client_id?: string | null;
          created_at?: string;
          event_date: string;
          event_time: string;
          gcal_event_id?: string | null;
          id?: string;
          location?: string | null;
          title: string;
          type?: string;
        };
        Update: {
          case_id?: string | null;
          client_id?: string | null;
          created_at?: string;
          event_date?: string;
          event_time?: string;
          gcal_event_id?: string | null;
          id?: string;
          location?: string | null;
          title?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agenda_events_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agenda_events_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_analysis_runs: {
        Row: {
          analysis_type: string;
          case_id: string | null;
          completed_at: string | null;
          confidence_score: number | null;
          created_at: string;
          created_by: string | null;
          document_id: string | null;
          error_message: string | null;
          estimated_cost: number | null;
          id: string;
          import_job_id: string | null;
          input_reference: string | null;
          model_name: string;
          model_provider: string;
          output_data: Json;
          prompt_version: string;
          started_at: string | null;
          status: string;
          token_usage: Json | null;
        };
        Insert: {
          analysis_type: string;
          case_id?: string | null;
          completed_at?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          error_message?: string | null;
          estimated_cost?: number | null;
          id?: string;
          import_job_id?: string | null;
          input_reference?: string | null;
          model_name: string;
          model_provider: string;
          output_data?: Json;
          prompt_version: string;
          started_at?: string | null;
          status?: string;
          token_usage?: Json | null;
        };
        Update: {
          analysis_type?: string;
          case_id?: string | null;
          completed_at?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          error_message?: string | null;
          estimated_cost?: number | null;
          id?: string;
          import_job_id?: string | null;
          input_reference?: string | null;
          model_name?: string;
          model_provider?: string;
          output_data?: Json;
          prompt_version?: string;
          started_at?: string | null;
          status?: string;
          token_usage?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_analysis_runs_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_analysis_runs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_analysis_runs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_analysis_runs_import_job_id_fkey";
            columns: ["import_job_id"];
            isOneToOne: false;
            referencedRelation: "import_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_findings: {
        Row: {
          analysis_run_id: string;
          case_id: string | null;
          client_id: string | null;
          confidence_score: number | null;
          created_at: string;
          document_id: string | null;
          field_name: string;
          finding_type: string;
          id: string;
          normalized_value: Json | null;
          proposed_value: Json | null;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source_excerpt: string | null;
          source_page: number | null;
          verification_status: string;
        };
        Insert: {
          analysis_run_id: string;
          case_id?: string | null;
          client_id?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          document_id?: string | null;
          field_name: string;
          finding_type: string;
          id?: string;
          normalized_value?: Json | null;
          proposed_value?: Json | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_excerpt?: string | null;
          source_page?: number | null;
          verification_status?: string;
        };
        Update: {
          analysis_run_id?: string;
          case_id?: string | null;
          client_id?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          document_id?: string | null;
          field_name?: string;
          finding_type?: string;
          id?: string;
          normalized_value?: Json | null;
          proposed_value?: Json | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_excerpt?: string | null;
          source_page?: number | null;
          verification_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_findings_analysis_run_id_fkey";
            columns: ["analysis_run_id"];
            isOneToOne: false;
            referencedRelation: "ai_analysis_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_findings_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_findings_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_findings_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_findings_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      case_events: {
        Row: {
          case_id: string;
          confidence_score: number | null;
          created_at: string;
          created_by: string | null;
          created_by_ai: boolean;
          description: string | null;
          document_id: string | null;
          event_date: string;
          event_type: string;
          id: string;
          source_excerpt: string | null;
          source_page: number | null;
          title: string;
          updated_at: string;
          verification_status: string;
          verified_at: string | null;
          verified_by: string | null;
        };
        Insert: {
          case_id: string;
          confidence_score?: number | null;
          created_at?: string;
          created_by?: string | null;
          created_by_ai?: boolean;
          description?: string | null;
          document_id?: string | null;
          event_date: string;
          event_type: string;
          id?: string;
          source_excerpt?: string | null;
          source_page?: number | null;
          title: string;
          updated_at?: string;
          verification_status?: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Update: {
          case_id?: string;
          confidence_score?: number | null;
          created_at?: string;
          created_by?: string | null;
          created_by_ai?: boolean;
          description?: string | null;
          document_id?: string | null;
          event_date?: string;
          event_type?: string;
          id?: string;
          source_excerpt?: string | null;
          source_page?: number | null;
          title?: string;
          updated_at?: string;
          verification_status?: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "case_events_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_events_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_events_verified_by_fkey";
            columns: ["verified_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      case_parties: {
        Row: {
          address: string | null;
          birth_date: string | null;
          case_id: string;
          client_id: string | null;
          created_at: string;
          created_by: string | null;
          document_number: string | null;
          document_type: string | null;
          email: string | null;
          full_name: string;
          id: string;
          is_minor: boolean;
          notes: string | null;
          phone: string | null;
          relationship: string | null;
          role: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          birth_date?: string | null;
          case_id: string;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          document_number?: string | null;
          document_type?: string | null;
          email?: string | null;
          full_name: string;
          id?: string;
          is_minor?: boolean;
          notes?: string | null;
          phone?: string | null;
          relationship?: string | null;
          role: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          birth_date?: string | null;
          case_id?: string;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          document_number?: string | null;
          document_type?: string | null;
          email?: string | null;
          full_name?: string;
          id?: string;
          is_minor?: boolean;
          notes?: string | null;
          phone?: string | null;
          relationship?: string | null;
          role?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_parties_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_parties_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_parties_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      case_tasks: {
        Row: {
          assigned_to: string | null;
          case_id: string | null;
          client_id: string | null;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string | null;
          created_by_ai: boolean;
          description: string | null;
          due_date: string | null;
          id: string;
          is_all_day: boolean;
          priority: string;
          source: string;
          status: string;
          title: string;
          updated_at: string;
          verification_status: string;
        };
        Insert: {
          assigned_to?: string | null;
          case_id?: string | null;
          client_id?: string | null;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_ai?: boolean;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          is_all_day?: boolean;
          priority?: string;
          source?: string;
          status?: string;
          title: string;
          updated_at?: string;
          verification_status?: string;
        };
        Update: {
          assigned_to?: string | null;
          case_id?: string | null;
          client_id?: string | null;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_ai?: boolean;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          is_all_day?: boolean;
          priority?: string;
          source?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          verification_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_tasks_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_tasks_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_tasks_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_tasks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_tasks_completed_by_fkey";
            columns: ["completed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      cases: {
        Row: {
          case_name: string | null;
          case_number: string | null;
          case_stage: string | null;
          case_type: string | null;
          case_year: number | null;
          client_id: string;
          closing_date: string | null;
          court: string | null;
          created_at: string;
          created_by: string | null;
          current_status_description: string | null;
          current_summary: string | null;
          demandado: string | null;
          demandante: string | null;
          expediente: string;
          filing_date: string | null;
          id: string;
          internal_code: string | null;
          judge_or_prosecutor: string | null;
          judicial_district: string | null;
          juzgado: string;
          last_action_date: string | null;
          legal_area: string | null;
          materia: string | null;
          next_action: string | null;
          next_hearing: string | null;
          priority: string;
          process_type: string;
          responsible_user_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          case_name?: string | null;
          case_number?: string | null;
          case_stage?: string | null;
          case_type?: string | null;
          case_year?: number | null;
          client_id: string;
          closing_date?: string | null;
          court?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_status_description?: string | null;
          current_summary?: string | null;
          demandado?: string | null;
          demandante?: string | null;
          expediente: string;
          filing_date?: string | null;
          id?: string;
          internal_code?: string | null;
          judge_or_prosecutor?: string | null;
          judicial_district?: string | null;
          juzgado: string;
          last_action_date?: string | null;
          legal_area?: string | null;
          materia?: string | null;
          next_action?: string | null;
          next_hearing?: string | null;
          priority?: string;
          process_type: string;
          responsible_user_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          case_name?: string | null;
          case_number?: string | null;
          case_stage?: string | null;
          case_type?: string | null;
          case_year?: number | null;
          client_id?: string;
          closing_date?: string | null;
          court?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_status_description?: string | null;
          current_summary?: string | null;
          demandado?: string | null;
          demandante?: string | null;
          expediente?: string;
          filing_date?: string | null;
          id?: string;
          internal_code?: string | null;
          judge_or_prosecutor?: string | null;
          judicial_district?: string | null;
          juzgado?: string;
          last_action_date?: string | null;
          legal_area?: string | null;
          materia?: string | null;
          next_action?: string | null;
          next_hearing?: string | null;
          priority?: string;
          process_type?: string;
          responsible_user_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cases_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_responsible_user_id_fkey";
            columns: ["responsible_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      client_reports: {
        Row: {
          author_id: string | null;
          body: string;
          case_id: string | null;
          category: string;
          client_id: string;
          created_at: string;
          current_status: string | null;
          final_text: string | null;
          id: string;
          informative_message: string | null;
          materia: string | null;
          reminder_days: number | null;
          status_date: string | null;
          title: string;
        };
        Insert: {
          author_id?: string | null;
          body: string;
          case_id?: string | null;
          category?: string;
          client_id: string;
          created_at?: string;
          current_status?: string | null;
          final_text?: string | null;
          id?: string;
          informative_message?: string | null;
          materia?: string | null;
          reminder_days?: number | null;
          status_date?: string | null;
          title: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          case_id?: string | null;
          category?: string;
          client_id?: string;
          created_at?: string;
          current_status?: string | null;
          final_text?: string | null;
          id?: string;
          informative_message?: string | null;
          materia?: string | null;
          reminder_days?: number | null;
          status_date?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_reports_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_reports_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_reports_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          address: string | null;
          birthdate: string | null;
          civil_status: string | null;
          color: string;
          created_at: string;
          created_by: string | null;
          /** Nullable after migration 20260724000000 — bulk import leaves this NULL */
          dni: string | null;
          document_number: string | null;
          document_type: string;
          email: string | null;
          id: string;
          initials: string;
          name: string;
          notes: string | null;
          occupation: string | null;
          /** Nullable after migration 20260724000000 — bulk import leaves this NULL */
          phone: string | null;
          /** Nullable after migration 20260724000000 — bulk import leaves this NULL */
          process_type: string | null;
          registered_at: string;
          status: string;
          updated_at: string;
          whatsapp: string | null;
        };
        Insert: {
          address?: string | null;
          birthdate?: string | null;
          civil_status?: string | null;
          color?: string;
          created_at?: string;
          created_by?: string | null;
          /** Nullable after migration 20260724000000 */
          dni?: string | null;
          document_number?: string | null;
          document_type?: string;
          email?: string | null;
          id?: string;
          initials: string;
          name: string;
          notes?: string | null;
          occupation?: string | null;
          /** Nullable after migration 20260724000000 */
          phone?: string | null;
          /** Nullable after migration 20260724000000 */
          process_type?: string | null;
          registered_at?: string;
          status?: string;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Update: {
          address?: string | null;
          birthdate?: string | null;
          civil_status?: string | null;
          color?: string;
          created_at?: string;
          created_by?: string | null;
          dni?: string | null;
          document_number?: string | null;
          document_type?: string;
          email?: string | null;
          id?: string;
          initials?: string;
          name?: string;
          notes?: string | null;
          occupation?: string | null;
          phone?: string | null;
          process_type?: string | null;
          registered_at?: string;
          status?: string;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      document_extractions: {
        Row: {
          confidence_score: number | null;
          created_at: string;
          document_id: string;
          error_message: string | null;
          extraction_method: string;
          id: string;
          language: string | null;
          model_name: string | null;
          ocr_used: boolean;
          page_count: number | null;
          processing_duration_ms: number | null;
          raw_text: string | null;
          status: string;
          structured_data: Json;
        };
        Insert: {
          confidence_score?: number | null;
          created_at?: string;
          document_id: string;
          error_message?: string | null;
          extraction_method: string;
          id?: string;
          language?: string | null;
          model_name?: string | null;
          ocr_used?: boolean;
          page_count?: number | null;
          processing_duration_ms?: number | null;
          raw_text?: string | null;
          status?: string;
          structured_data?: Json;
        };
        Update: {
          confidence_score?: number | null;
          created_at?: string;
          document_id?: string;
          error_message?: string | null;
          extraction_method?: string;
          id?: string;
          language?: string | null;
          model_name?: string | null;
          ocr_used?: boolean;
          page_count?: number | null;
          processing_duration_ms?: number | null;
          raw_text?: string | null;
          status?: string;
          structured_data?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "document_extractions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      document_folders: {
        Row: {
          id: string;
          client_id: string;
          parent_id: string | null;
          name: string;
          normalized_name: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          parent_id?: string | null;
          name: string;
          normalized_name: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          parent_id?: string | null;
          name?: string;
          normalized_name?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_folders_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_folders_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "document_folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_folders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          case_id: string | null;
          checksum: string | null;
          client_id: string | null;
          created_at: string;
          created_by: string | null;
          display_name: string | null;
          document_date: string | null;
          document_type: string | null;
          external_file_id: string | null;
          external_folder_id: string | null;
          external_url: string | null;
          file_size: number | null;
          id: string;
          is_confidential: boolean;
          mime_type: string | null;
          name: string;
          original_name: string | null;
          processing_status: string;
          size: string;
          source_provider: string | null;
          source_type: string;
          storage_path: string;
          type: string;
          updated_at: string;
          uploaded_at: string;
          verification_status: string;
          /** Path relative to the client folder, e.g. "Resoluciones/res01.pdf". Added by migration 20260724000000. */
          relative_path: string | null;
          /** SHA-256 hex of file content. Added by migration 20260724000000. */
          content_hash: string | null;
          /** Logical folder assignment. Added by migration 20260725120000. */
          folder_id: string | null;
        };
        Insert: {
          case_id?: string | null;
          checksum?: string | null;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string | null;
          document_date?: string | null;
          document_type?: string | null;
          external_file_id?: string | null;
          external_folder_id?: string | null;
          external_url?: string | null;
          file_size?: number | null;
          id?: string;
          is_confidential?: boolean;
          mime_type?: string | null;
          name: string;
          original_name?: string | null;
          processing_status?: string;
          size: string;
          source_provider?: string | null;
          source_type?: string;
          storage_path: string;
          type: string;
          updated_at?: string;
          uploaded_at?: string;
          verification_status?: string;
          relative_path?: string | null;
          content_hash?: string | null;
          folder_id?: string | null;
        };
        Update: {
          case_id?: string | null;
          checksum?: string | null;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string | null;
          document_date?: string | null;
          document_type?: string | null;
          external_file_id?: string | null;
          external_folder_id?: string | null;
          external_url?: string | null;
          file_size?: number | null;
          id?: string;
          is_confidential?: boolean;
          mime_type?: string | null;
          name?: string;
          original_name?: string | null;
          processing_status?: string;
          size?: string;
          source_provider?: string | null;
          source_type?: string;
          storage_path?: string;
          type?: string;
          updated_at?: string;
          uploaded_at?: string;
          verification_status?: string;
          relative_path?: string | null;
          content_hash?: string | null;
          folder_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      import_folders: {
        Row: {
          analysis_status: string;
          analysis_summary: string | null;
          confidence_score: number | null;
          created_at: string;
          detected_case_id: string | null;
          detected_client_id: string | null;
          external_folder_id: string;
          folder_name: string;
          folder_path: string;
          id: string;
          import_job_id: string;
          parent_external_folder_id: string | null;
          updated_at: string;
        };
        Insert: {
          analysis_status?: string;
          analysis_summary?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          detected_case_id?: string | null;
          detected_client_id?: string | null;
          external_folder_id: string;
          folder_name: string;
          folder_path: string;
          id?: string;
          import_job_id: string;
          parent_external_folder_id?: string | null;
          updated_at?: string;
        };
        Update: {
          analysis_status?: string;
          analysis_summary?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          detected_case_id?: string | null;
          detected_client_id?: string | null;
          external_folder_id?: string;
          folder_name?: string;
          folder_path?: string;
          id?: string;
          import_job_id?: string;
          parent_external_folder_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_folders_detected_case_id_fkey";
            columns: ["detected_case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_folders_detected_client_id_fkey";
            columns: ["detected_client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_folders_import_job_id_fkey";
            columns: ["import_job_id"];
            isOneToOne: false;
            referencedRelation: "import_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      import_jobs: {
        Row: {
          completed_at: string | null;
          configuration: Json;
          created_at: string;
          created_by: string | null;
          detected_cases: number;
          detected_clients: number;
          error_message: string | null;
          failed_documents: number;
          id: string;
          name: string;
          processed_documents: number;
          progress_percentage: number;
          provider: string;
          source_folder_id: string | null;
          source_folder_url: string | null;
          started_at: string | null;
          status: string;
          total_documents: number;
          total_folders: number;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          configuration?: Json;
          created_at?: string;
          created_by?: string | null;
          detected_cases?: number;
          detected_clients?: number;
          error_message?: string | null;
          failed_documents?: number;
          id?: string;
          name: string;
          processed_documents?: number;
          progress_percentage?: number;
          provider?: string;
          source_folder_id?: string | null;
          source_folder_url?: string | null;
          started_at?: string | null;
          status?: string;
          total_documents?: number;
          total_folders?: number;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          configuration?: Json;
          created_at?: string;
          created_by?: string | null;
          detected_cases?: number;
          detected_clients?: number;
          error_message?: string | null;
          failed_documents?: number;
          id?: string;
          name?: string;
          processed_documents?: number;
          progress_percentage?: number;
          provider?: string;
          source_folder_id?: string | null;
          source_folder_url?: string | null;
          started_at?: string | null;
          status?: string;
          total_documents?: number;
          total_folders?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_jobs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_records: {
        Row: {
          amount: number;
          created_at: string;
          id: string;
          method: string;
          notes: string | null;
          payment_date: string;
          payment_id: string;
          receipt: string | null;
        };
        Insert: {
          amount: number;
          created_at?: string;
          id?: string;
          method: string;
          notes?: string | null;
          payment_date?: string;
          payment_id: string;
          receipt?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          id?: string;
          method?: string;
          notes?: string | null;
          payment_date?: string;
          payment_id?: string;
          receipt?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_records_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          case_id: string | null;
          client_id: string;
          created_at: string;
          fees: number;
          id: string;
          paid: number;
          paid_installments: number;
          service: string;
          status: string;
          total_installments: number;
        };
        Insert: {
          case_id?: string | null;
          client_id: string;
          created_at?: string;
          fees: number;
          id?: string;
          paid?: number;
          paid_installments?: number;
          service: string;
          status?: string;
          total_installments?: number;
        };
        Update: {
          case_id?: string | null;
          client_id?: string;
          created_at?: string;
          fees?: number;
          id?: string;
          paid?: number;
          paid_installments?: number;
          service?: string;
          status?: string;
          total_installments?: number;
        };
        Relationships: [
          {
            foreignKeyName: "payments_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          initials: string;
          phone: string | null;
          role: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name: string;
          id: string;
          initials: string;
          phone?: string | null;
          role?: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          initials?: string;
          phone?: string | null;
          role?: string;
          status?: string;
        };
        Relationships: [];
      };
      source_references: {
        Row: {
          confidence_score: number | null;
          created_at: string;
          created_by: string | null;
          document_id: string | null;
          entity_id: string;
          entity_type: string;
          field_name: string;
          id: string;
          source_excerpt: string | null;
          source_page: number | null;
        };
        Insert: {
          confidence_score?: number | null;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          entity_id: string;
          entity_type: string;
          field_name: string;
          id?: string;
          source_excerpt?: string | null;
          source_page?: number | null;
        };
        Update: {
          confidence_score?: number | null;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          field_name?: string;
          id?: string;
          source_excerpt?: string | null;
          source_page?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "source_references_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "source_references_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_admin: { Args: never; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      register_payment_record_atomic: {
        Args: {
          p_amount: number;
          p_method: string;
          p_notes?: string | null;
          p_payment_date?: string | null;
          p_payment_id: string;
          p_receipt?: string | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
