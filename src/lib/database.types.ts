export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      agenda_events: {
        Row: {
          case_id: string | null;
          client_id: string | null;
          created_at: string;
          deleted_at: string | null;
          event_date: string;
          event_time: string;
          google_calendar_id: string | null;
          google_etag: string | null;
          google_event_id: string | null;
          google_html_link: string | null;
          google_updated_at: string | null;
          id: string;
          last_synced_at: string | null;
          location: string | null;
          sync_error: string | null;
          sync_origin: string;
          sync_status: string;
          title: string;
          type: string;
          updated_at: string;
        };
        Insert: {
          case_id?: string | null;
          client_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          event_date: string;
          event_time: string;
          google_calendar_id?: string | null;
          google_etag?: string | null;
          google_event_id?: string | null;
          google_html_link?: string | null;
          google_updated_at?: string | null;
          id?: string;
          last_synced_at?: string | null;
          location?: string | null;
          sync_error?: string | null;
          sync_origin?: string;
          sync_status?: string;
          title: string;
          type?: string;
          updated_at?: string;
        };
        Update: {
          case_id?: string | null;
          client_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          event_date?: string;
          event_time?: string;
          google_calendar_id?: string | null;
          google_etag?: string | null;
          google_event_id?: string | null;
          google_html_link?: string | null;
          google_updated_at?: string | null;
          id?: string;
          last_synced_at?: string | null;
          location?: string | null;
          sync_error?: string | null;
          sync_origin?: string;
          sync_status?: string;
          title?: string;
          type?: string;
          updated_at?: string;
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
      case_task_history: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          changes: Json;
          id: string;
          new_scheduled_for: string | null;
          new_status: string | null;
          old_scheduled_for: string | null;
          old_status: string | null;
          task_id: string;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          changes?: Json;
          id?: string;
          new_scheduled_for?: string | null;
          new_status?: string | null;
          old_scheduled_for?: string | null;
          old_status?: string | null;
          task_id: string;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          changes?: Json;
          id?: string;
          new_scheduled_for?: string | null;
          new_status?: string | null;
          old_scheduled_for?: string | null;
          old_status?: string | null;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "case_task_history_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_task_history_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "case_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      case_tasks: {
        Row: {
          assigned_to: string | null;
          case_id: string | null;
          claimed_at: string | null;
          claimed_by: string | null;
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
          scheduled_for: string;
          source: string;
          started_at: string | null;
          status: string;
          title: string;
          updated_at: string;
          verification_status: string;
        };
        Insert: {
          assigned_to?: string | null;
          case_id?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
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
          scheduled_for?: string;
          source?: string;
          started_at?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          verification_status?: string;
        };
        Update: {
          assigned_to?: string | null;
          case_id?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
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
          scheduled_for?: string;
          source?: string;
          started_at?: string | null;
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
            foreignKeyName: "case_tasks_claimed_by_fkey";
            columns: ["claimed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
            foreignKeyName: "case_tasks_completed_by_fkey";
            columns: ["completed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_tasks_created_by_fkey";
            columns: ["created_by"];
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
          case_type: string | null;
          case_year: number | null;
          client_id: string;
          closing_date: string | null;
          created_at: string;
          created_by: string | null;
          current_status_description: string | null;
          current_summary: string | null;
          expediente: string;
          filing_date: string | null;
          id: string;
          internal_code: string | null;
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
          case_type?: string | null;
          case_year?: number | null;
          client_id: string;
          closing_date?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_status_description?: string | null;
          current_summary?: string | null;
          expediente: string;
          filing_date?: string | null;
          id?: string;
          internal_code?: string | null;
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
          case_type?: string | null;
          case_year?: number | null;
          client_id?: string;
          closing_date?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_status_description?: string | null;
          current_summary?: string | null;
          expediente?: string;
          filing_date?: string | null;
          id?: string;
          internal_code?: string | null;
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
          color: string;
          created_at: string;
          created_by: string | null;
          email: string | null;
          id: string;
          initials: string;
          name: string;
          phone: string | null;
          registered_at: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          id?: string;
          initials: string;
          name: string;
          phone?: string | null;
          registered_at?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          id?: string;
          initials?: string;
          name?: string;
          phone?: string | null;
          registered_at?: string;
          status?: string;
          updated_at?: string;
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
      document_change_history: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          changes: Json;
          document_id: string;
          id: string;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          changes: Json;
          document_id: string;
          id?: string;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          changes?: Json;
          document_id?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_change_history_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_change_history_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
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
          client_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          normalized_name: string;
          parent_id: string | null;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          normalized_name: string;
          parent_id?: string | null;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          normalized_name?: string;
          parent_id?: string | null;
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
            foreignKeyName: "document_folders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_folders_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "document_folders";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          case_id: string | null;
          checksum: string | null;
          client_id: string | null;
          content_hash: string | null;
          created_at: string;
          created_by: string | null;
          display_name: string | null;
          document_date: string | null;
          document_type: string | null;
          external_file_id: string | null;
          external_folder_id: string | null;
          external_url: string | null;
          file_size: number | null;
          folder_id: string | null;
          id: string;
          is_confidential: boolean;
          mime_type: string | null;
          name: string;
          original_name: string | null;
          processing_status: string;
          relative_path: string | null;
          size: string;
          source_provider: string | null;
          source_type: string;
          storage_path: string;
          type: string;
          updated_at: string;
          uploaded_at: string;
          verification_status: string;
        };
        Insert: {
          case_id?: string | null;
          checksum?: string | null;
          client_id?: string | null;
          content_hash?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string | null;
          document_date?: string | null;
          document_type?: string | null;
          external_file_id?: string | null;
          external_folder_id?: string | null;
          external_url?: string | null;
          file_size?: number | null;
          folder_id?: string | null;
          id?: string;
          is_confidential?: boolean;
          mime_type?: string | null;
          name: string;
          original_name?: string | null;
          processing_status?: string;
          relative_path?: string | null;
          size: string;
          source_provider?: string | null;
          source_type?: string;
          storage_path: string;
          type: string;
          updated_at?: string;
          uploaded_at?: string;
          verification_status?: string;
        };
        Update: {
          case_id?: string | null;
          checksum?: string | null;
          client_id?: string | null;
          content_hash?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string | null;
          document_date?: string | null;
          document_type?: string | null;
          external_file_id?: string | null;
          external_folder_id?: string | null;
          external_url?: string | null;
          file_size?: number | null;
          folder_id?: string | null;
          id?: string;
          is_confidential?: boolean;
          mime_type?: string | null;
          name?: string;
          original_name?: string | null;
          processing_status?: string;
          relative_path?: string | null;
          size?: string;
          source_provider?: string | null;
          source_type?: string;
          storage_path?: string;
          type?: string;
          updated_at?: string;
          uploaded_at?: string;
          verification_status?: string;
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
          {
            foreignKeyName: "documents_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "document_folders";
            referencedColumns: ["id"];
          },
        ];
      };
      google_calendar_channels: {
        Row: {
          channel_id: string;
          channel_token_hash: string;
          connection_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          last_message_number: number | null;
          resource_id: string;
          stopped_at: string | null;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          channel_token_hash: string;
          connection_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          last_message_number?: number | null;
          resource_id: string;
          stopped_at?: string | null;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          channel_token_hash?: string;
          connection_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          last_message_number?: number | null;
          resource_id?: string;
          stopped_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_calendar_channels_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "google_calendar_connections";
            referencedColumns: ["id"];
          },
        ];
      };
      google_calendar_connections: {
        Row: {
          access_token_expires_at: string | null;
          calendar_id: string;
          calendar_name: string | null;
          connected_by: string;
          created_at: string;
          encrypted_refresh_token: string;
          google_account_email: string | null;
          id: string;
          last_error: string | null;
          last_synced_at: string | null;
          status: string;
          sync_token: string | null;
          updated_at: string;
        };
        Insert: {
          access_token_expires_at?: string | null;
          calendar_id: string;
          calendar_name?: string | null;
          connected_by: string;
          created_at?: string;
          encrypted_refresh_token: string;
          google_account_email?: string | null;
          id?: string;
          last_error?: string | null;
          last_synced_at?: string | null;
          status?: string;
          sync_token?: string | null;
          updated_at?: string;
        };
        Update: {
          access_token_expires_at?: string | null;
          calendar_id?: string;
          calendar_name?: string | null;
          connected_by?: string;
          created_at?: string;
          encrypted_refresh_token?: string;
          google_account_email?: string | null;
          id?: string;
          last_error?: string | null;
          last_synced_at?: string | null;
          status?: string;
          sync_token?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_calendar_connections_connected_by_fkey";
            columns: ["connected_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      google_calendar_oauth_states: {
        Row: {
          calendar_id: string;
          code_verifier: string;
          created_at: string;
          expires_at: string;
          requested_by: string;
          state_hash: string;
        };
        Insert: {
          calendar_id: string;
          code_verifier: string;
          created_at?: string;
          expires_at: string;
          requested_by: string;
          state_hash: string;
        };
        Update: {
          calendar_id?: string;
          code_verifier?: string;
          created_at?: string;
          expires_at?: string;
          requested_by?: string;
          state_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_calendar_oauth_states_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      google_calendar_sync_log: {
        Row: {
          agenda_event_id: string | null;
          connection_id: string | null;
          created_at: string;
          direction: string;
          error_code: string | null;
          error_message: string | null;
          google_event_id: string | null;
          id: number;
          operation: string;
          status: string;
        };
        Insert: {
          agenda_event_id?: string | null;
          connection_id?: string | null;
          created_at?: string;
          direction: string;
          error_code?: string | null;
          error_message?: string | null;
          google_event_id?: string | null;
          id?: never;
          operation: string;
          status: string;
        };
        Update: {
          agenda_event_id?: string | null;
          connection_id?: string | null;
          created_at?: string;
          direction?: string;
          error_code?: string | null;
          error_message?: string | null;
          google_event_id?: string | null;
          id?: never;
          operation?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_calendar_sync_log_agenda_event_id_fkey";
            columns: ["agenda_event_id"];
            isOneToOne: false;
            referencedRelation: "agenda_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "google_calendar_sync_log_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "google_calendar_connections";
            referencedColumns: ["id"];
          },
        ];
      };
      google_calendar_sync_requests: {
        Row: {
          channel_id: string | null;
          connection_id: string;
          created_at: string;
          error_message: string | null;
          id: number;
          message_number: number | null;
          processed_at: string | null;
          status: string;
        };
        Insert: {
          channel_id?: string | null;
          connection_id: string;
          created_at?: string;
          error_message?: string | null;
          id?: never;
          message_number?: number | null;
          processed_at?: string | null;
          status?: string;
        };
        Update: {
          channel_id?: string | null;
          connection_id?: string;
          created_at?: string;
          error_message?: string | null;
          id?: never;
          message_number?: number | null;
          processed_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_calendar_sync_requests_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "google_calendar_connections";
            referencedColumns: ["id"];
          },
        ];
      };
      google_drive_channels: {
        Row: {
          channel_id: string;
          channel_token_hash: string;
          connection_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          last_message_number: number | null;
          resource_id: string;
          stopped_at: string | null;
          updated_at: string;
        };
        Insert: {
          channel_id: string;
          channel_token_hash: string;
          connection_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          last_message_number?: number | null;
          resource_id: string;
          stopped_at?: string | null;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          channel_token_hash?: string;
          connection_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          last_message_number?: number | null;
          resource_id?: string;
          stopped_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_drive_channels_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "google_drive_connections";
            referencedColumns: ["id"];
          },
        ];
      };
      google_drive_client_folders: {
        Row: {
          client_id: string;
          connection_id: string;
          created_at: string;
          drive_folder_id: string;
          drive_folder_name_snapshot: string | null;
          id: string;
          last_synced_at: string | null;
          linked_at: string;
          linked_by: string | null;
          match_type: string;
          sync_error: string | null;
          sync_status: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          connection_id: string;
          created_at?: string;
          drive_folder_id: string;
          drive_folder_name_snapshot?: string | null;
          id?: string;
          last_synced_at?: string | null;
          linked_at?: string;
          linked_by?: string | null;
          match_type: string;
          sync_error?: string | null;
          sync_status?: string;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          connection_id?: string;
          created_at?: string;
          drive_folder_id?: string;
          drive_folder_name_snapshot?: string | null;
          id?: string;
          last_synced_at?: string | null;
          linked_at?: string;
          linked_by?: string | null;
          match_type?: string;
          sync_error?: string | null;
          sync_status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_drive_client_folders_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: true;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "google_drive_client_folders_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "google_drive_connections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "google_drive_client_folders_linked_by_fkey";
            columns: ["linked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      google_drive_connections: {
        Row: {
          access_token_expires_at: string | null;
          changes_page_token: string | null;
          connected_by: string;
          created_at: string;
          encrypted_refresh_token: string | null;
          google_account_email: string | null;
          granted_scopes: string | null;
          id: string;
          last_error: string | null;
          last_synced_at: string | null;
          root_folder_id: string | null;
          root_folder_name: string | null;
          shared_drive_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          access_token_expires_at?: string | null;
          changes_page_token?: string | null;
          connected_by: string;
          created_at?: string;
          encrypted_refresh_token?: string | null;
          google_account_email?: string | null;
          granted_scopes?: string | null;
          id?: string;
          last_error?: string | null;
          last_synced_at?: string | null;
          root_folder_id?: string | null;
          root_folder_name?: string | null;
          shared_drive_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          access_token_expires_at?: string | null;
          changes_page_token?: string | null;
          connected_by?: string;
          created_at?: string;
          encrypted_refresh_token?: string | null;
          google_account_email?: string | null;
          granted_scopes?: string | null;
          id?: string;
          last_error?: string | null;
          last_synced_at?: string | null;
          root_folder_id?: string | null;
          root_folder_name?: string | null;
          shared_drive_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_drive_connections_connected_by_fkey";
            columns: ["connected_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      google_drive_document_files: {
        Row: {
          connection_id: string;
          created_at: string;
          document_id: string;
          drive_file_id: string;
          drive_parent_id: string;
          drive_web_view_link: string | null;
          id: string;
          last_synced_at: string | null;
          last_synced_content_hash: string | null;
          last_synced_drive_md5_checksum: string | null;
          last_synced_drive_modified_time: string | null;
          last_synced_drive_parent_id: string | null;
          last_synced_drive_version: number | null;
          last_synced_file_name: string | null;
          sync_error: string | null;
          sync_status: string;
          updated_at: string;
        };
        Insert: {
          connection_id: string;
          created_at?: string;
          document_id: string;
          drive_file_id: string;
          drive_parent_id: string;
          drive_web_view_link?: string | null;
          id?: string;
          last_synced_at?: string | null;
          last_synced_content_hash?: string | null;
          last_synced_drive_md5_checksum?: string | null;
          last_synced_drive_modified_time?: string | null;
          last_synced_drive_parent_id?: string | null;
          last_synced_drive_version?: number | null;
          last_synced_file_name?: string | null;
          sync_error?: string | null;
          sync_status?: string;
          updated_at?: string;
        };
        Update: {
          connection_id?: string;
          created_at?: string;
          document_id?: string;
          drive_file_id?: string;
          drive_parent_id?: string;
          drive_web_view_link?: string | null;
          id?: string;
          last_synced_at?: string | null;
          last_synced_content_hash?: string | null;
          last_synced_drive_md5_checksum?: string | null;
          last_synced_drive_modified_time?: string | null;
          last_synced_drive_parent_id?: string | null;
          last_synced_drive_version?: number | null;
          last_synced_file_name?: string | null;
          sync_error?: string | null;
          sync_status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_drive_document_files_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "google_drive_connections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "google_drive_document_files_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      google_drive_oauth_states: {
        Row: {
          code_verifier: string;
          created_at: string;
          expires_at: string;
          requested_by: string;
          state_hash: string;
        };
        Insert: {
          code_verifier: string;
          created_at?: string;
          expires_at: string;
          requested_by: string;
          state_hash: string;
        };
        Update: {
          code_verifier?: string;
          created_at?: string;
          expires_at?: string;
          requested_by?: string;
          state_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_drive_oauth_states_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      google_drive_sync_queue: {
        Row: {
          attempt_count: number;
          available_at: string;
          claimed_at: string | null;
          client_id: string | null;
          connection_id: string;
          created_at: string;
          dedupe_key: string;
          document_id: string | null;
          drive_file_id: string | null;
          id: number;
          last_error: string | null;
          operation: string;
          payload: Json;
          processed_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          available_at?: string;
          claimed_at?: string | null;
          client_id?: string | null;
          connection_id: string;
          created_at?: string;
          dedupe_key: string;
          document_id?: string | null;
          drive_file_id?: string | null;
          id?: never;
          last_error?: string | null;
          operation: string;
          payload?: Json;
          processed_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          available_at?: string;
          claimed_at?: string | null;
          client_id?: string | null;
          connection_id?: string;
          created_at?: string;
          dedupe_key?: string;
          document_id?: string | null;
          drive_file_id?: string | null;
          id?: never;
          last_error?: string | null;
          operation?: string;
          payload?: Json;
          processed_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "google_drive_sync_queue_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "google_drive_sync_queue_connection_id_fkey";
            columns: ["connection_id"];
            isOneToOne: false;
            referencedRelation: "google_drive_connections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "google_drive_sync_queue_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
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
      templates: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          file_name: string;
          id: string;
          mime_type: string;
          name: string;
          size: number;
          storage_path: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          file_name: string;
          id?: string;
          mime_type: string;
          name: string;
          size: number;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          file_name?: string;
          id?: string;
          mime_type?: string;
          name?: string;
          size?: number;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "templates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_case_task: {
        Args: { p_task_id: string };
        Returns: {
          assigned_to: string | null;
          case_id: string | null;
          claimed_at: string | null;
          claimed_by: string | null;
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
          scheduled_for: string;
          source: string;
          started_at: string | null;
          status: string;
          title: string;
          updated_at: string;
          verification_status: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "case_tasks";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_google_drive_sync_operations: {
        Args: { p_limit?: number };
        Returns: {
          attempt_count: number;
          available_at: string;
          claimed_at: string | null;
          client_id: string | null;
          connection_id: string;
          created_at: string;
          dedupe_key: string;
          document_id: string | null;
          drive_file_id: string | null;
          id: number;
          last_error: string | null;
          operation: string;
          payload: Json;
          processed_at: string | null;
          status: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "google_drive_sync_queue";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      apply_google_drive_client_folder_mappings: {
        Args: {
          p_connection_id: string;
          p_linked_by: string;
          p_expected_root_folder_id: string;
          p_mappings: Json;
        };
        Returns: Json;
      };
      set_google_drive_root_folder: {
        Args: {
          p_connection_id: string;
          p_expected_current_root_folder_id: string | null;
          p_new_root_folder_id: string;
          p_new_root_folder_name: string;
          p_new_shared_drive_id: string | null;
        };
        Returns: Json;
      };
      replace_google_drive_connection: {
        Args: {
          p_access_token_expires_at?: string | null;
          p_connected_by: string;
          p_encrypted_refresh_token: string;
          p_google_account_email?: string | null;
          p_granted_scopes?: string | null;
        };
        Returns: {
          access_token_expires_at: string | null;
          changes_page_token: string | null;
          connected_by: string;
          created_at: string;
          encrypted_refresh_token: string | null;
          google_account_email: string | null;
          granted_scopes: string | null;
          id: string;
          last_error: string | null;
          last_synced_at: string | null;
          root_folder_id: string | null;
          root_folder_name: string | null;
          shared_drive_id: string | null;
          status: string;
          updated_at: string;
        };
      };
      disconnect_google_drive_connection: {
        Args: never;
        Returns: {
          access_token_expires_at: string | null;
          changes_page_token: string | null;
          connected_by: string;
          created_at: string;
          encrypted_refresh_token: string | null;
          google_account_email: string | null;
          granted_scopes: string | null;
          id: string;
          last_error: string | null;
          last_synced_at: string | null;
          root_folder_id: string | null;
          root_folder_name: string | null;
          shared_drive_id: string | null;
          status: string;
          updated_at: string;
        };
      };
      crm_is_active_admin: { Args: never; Returns: boolean };
      crm_is_active_staff: { Args: never; Returns: boolean };
      is_admin: { Args: never; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      normalize_document_types: {
        Args: { p_apply?: boolean };
        Returns: {
          canonical_value: string;
          document_id: string;
          is_known: boolean;
          previous_value: string;
          was_applied: boolean;
        }[];
      };
      register_payment_record_atomic: {
        Args: {
          p_amount: number;
          p_method: string;
          p_notes?: string;
          p_payment_date?: string;
          p_payment_id: string;
          p_receipt?: string;
        };
        Returns: Json;
      };
      return_case_task: {
        Args: { p_task_id: string };
        Returns: {
          assigned_to: string | null;
          case_id: string | null;
          claimed_at: string | null;
          claimed_by: string | null;
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
          scheduled_for: string;
          source: string;
          started_at: string | null;
          status: string;
          title: string;
          updated_at: string;
          verification_status: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "case_tasks";
          isOneToOne: false;
          isSetofReturn: true;
        };
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
