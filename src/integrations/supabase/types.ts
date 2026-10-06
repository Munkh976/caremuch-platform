export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agency: {
        Row: {
          address: string | null
          agency_name: string
          business_type: string | null
          city: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          late_trade_hours: number
          max_weekly_hours: number
          naics_code: string | null
          phone: string | null
          smart_match_weights: Json
          state: string | null
          tax_id: string | null
          travel_buffer_minutes: number
          updated_at: string | null
          website: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          agency_name: string
          business_type?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          late_trade_hours?: number
          max_weekly_hours?: number
          naics_code?: string | null
          phone?: string | null
          smart_match_weights?: Json
          state?: string | null
          tax_id?: string | null
          travel_buffer_minutes?: number
          updated_at?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          agency_name?: string
          business_type?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          late_trade_hours?: number
          max_weekly_hours?: number
          naics_code?: string | null
          phone?: string | null
          smart_match_weights?: Json
          state?: string | null
          tax_id?: string | null
          travel_buffer_minutes?: number
          updated_at?: string | null
          website?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      billing_batches: {
        Row: {
          agency_id: string
          billed_at: string | null
          billed_by: string | null
          created_at: string
          created_by: string | null
          export_ref: string | null
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["billing_batch_status"]
          supplement: number
          virtual_office_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          agency_id: string
          billed_at?: string | null
          billed_by?: string | null
          created_at?: string
          created_by?: string | null
          export_ref?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["billing_batch_status"]
          supplement?: number
          virtual_office_id: string
          week_end: string
          week_start: string
        }
        Update: {
          agency_id?: string
          billed_at?: string | null
          billed_by?: string | null
          created_at?: string
          created_by?: string | null
          export_ref?: string | null
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["billing_batch_status"]
          supplement?: number
          virtual_office_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_batches_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_batches_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_attendees: {
        Row: {
          attended: boolean | null
          care_plan_id: string
          contributed: boolean | null
          id: string
          name: string | null
          relationship: string | null
        }
        Insert: {
          attended?: boolean | null
          care_plan_id: string
          contributed?: boolean | null
          id?: string
          name?: string | null
          relationship?: string | null
        }
        Update: {
          attended?: boolean | null
          care_plan_id?: string
          contributed?: boolean | null
          id?: string
          name?: string | null
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_attendees_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_dsm_recommendations: {
        Row: {
          care_plan_id: string
          id: string
          notes: string | null
          outcome_code: string
          service: string
        }
        Insert: {
          care_plan_id: string
          id?: string
          notes?: string | null
          outcome_code: string
          service: string
        }
        Update: {
          care_plan_id?: string
          id?: string
          notes?: string | null
          outcome_code?: string
          service?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_dsm_recommendations_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_external_services: {
        Row: {
          auth_reference: string | null
          care_plan_id: string
          description: string | null
          effective_date: string | null
          expiration_date: string | null
          id: string
          provider_program: string | null
          service: string | null
          units_text: string | null
        }
        Insert: {
          auth_reference?: string | null
          care_plan_id: string
          description?: string | null
          effective_date?: string | null
          expiration_date?: string | null
          id?: string
          provider_program?: string | null
          service?: string | null
          units_text?: string | null
        }
        Update: {
          auth_reference?: string | null
          care_plan_id?: string
          description?: string | null
          effective_date?: string | null
          expiration_date?: string | null
          id?: string
          provider_program?: string | null
          service?: string | null
          units_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_external_services_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_goals: {
        Row: {
          care_plan_id: string
          goal_text: string
          id: string
          seq: number
          target_end: string | null
          target_start: string | null
        }
        Insert: {
          care_plan_id: string
          goal_text: string
          id?: string
          seq: number
          target_end?: string | null
          target_start?: string | null
        }
        Update: {
          care_plan_id?: string
          goal_text?: string
          id?: string
          seq?: number
          target_end?: string | null
          target_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_goals_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_natural_supports: {
        Row: {
          care_plan_id: string
          how_they_help: string | null
          id: string
          name: string | null
          status: string | null
          support_type: string | null
        }
        Insert: {
          care_plan_id: string
          how_they_help?: string | null
          id?: string
          name?: string | null
          status?: string | null
          support_type?: string | null
        }
        Update: {
          care_plan_id?: string
          how_they_help?: string | null
          id?: string
          name?: string | null
          status?: string | null
          support_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_natural_supports_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_needs: {
        Row: {
          additional_info: string | null
          addressed: boolean | null
          care_plan_id: string
          domain: string | null
          id: string
          item_kind: string
          item_text: string | null
          level_of_need: string | null
          source: string
        }
        Insert: {
          additional_info?: string | null
          addressed?: boolean | null
          care_plan_id: string
          domain?: string | null
          id?: string
          item_kind?: string
          item_text?: string | null
          level_of_need?: string | null
          source: string
        }
        Update: {
          additional_info?: string | null
          addressed?: boolean | null
          care_plan_id?: string
          domain?: string | null
          id?: string
          item_kind?: string
          item_text?: string | null
          level_of_need?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_needs_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_objective_needs: {
        Row: {
          objective_id: string
          treatment_need_id: string
        }
        Insert: {
          objective_id: string
          treatment_need_id: string
        }
        Update: {
          objective_id?: string
          treatment_need_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_objective_needs_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "care_plan_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_objective_needs_treatment_need_id_fkey"
            columns: ["treatment_need_id"]
            isOneToOne: false
            referencedRelation: "care_plan_treatment_needs"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_objectives: {
        Row: {
          goal_id: string
          id: string
          letter: string | null
          objective_text: string
          responsible_party: Database["public"]["Enums"]["objective_responsible_party"]
          seq: number
          service_type: string | null
          staff_instructions: string | null
          target_end: string | null
          target_start: string | null
        }
        Insert: {
          goal_id: string
          id?: string
          letter?: string | null
          objective_text: string
          responsible_party?: Database["public"]["Enums"]["objective_responsible_party"]
          seq?: number
          service_type?: string | null
          staff_instructions?: string | null
          target_end?: string | null
          target_start?: string | null
        }
        Update: {
          goal_id?: string
          id?: string
          letter?: string | null
          objective_text?: string
          responsible_party?: Database["public"]["Enums"]["objective_responsible_party"]
          seq?: number
          service_type?: string | null
          staff_instructions?: string | null
          target_end?: string | null
          target_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_objectives_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "care_plan_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_reviews: {
        Row: {
          care_plan_id: string
          id: string
          next_review_date: string | null
          notes: string | null
          review_date: string | null
        }
        Insert: {
          care_plan_id: string
          id?: string
          next_review_date?: string | null
          notes?: string | null
          review_date?: string | null
        }
        Update: {
          care_plan_id?: string
          id?: string
          next_review_date?: string | null
          notes?: string | null
          review_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_reviews_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_treatment_needs: {
        Row: {
          care_plan_id: string
          domain: string
          id: string
          new_need: boolean
          sort_order: number
          to_address: boolean
          treatment_recommendation: string | null
        }
        Insert: {
          care_plan_id: string
          domain: string
          id?: string
          new_need?: boolean
          sort_order?: number
          to_address?: boolean
          treatment_recommendation?: string | null
        }
        Update: {
          care_plan_id?: string
          domain?: string
          id?: string
          new_need?: boolean
          sort_order?: number
          to_address?: boolean
          treatment_recommendation?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_treatment_needs_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plans: {
        Row: {
          agency_id: string
          client_id: string
          created_at: string
          created_by: string | null
          discharge_criteria: string | null
          effective_date: string | null
          expiration_date: string | null
          facilitator_name: string | null
          field_snapshot: Json | null
          field_values: Json
          id: string
          meeting_date: string | null
          michicans_date: string | null
          next_review_date: string | null
          plan_type: Database["public"]["Enums"]["care_plan_type"]
          recorder_name: string | null
          review_frequency: string | null
          signed_by: string | null
          signed_date: string | null
          status: Database["public"]["Enums"]["care_plan_status"]
          template_id: string | null
          template_version: number | null
          training_version: number
          version: number
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          discharge_criteria?: string | null
          effective_date?: string | null
          expiration_date?: string | null
          facilitator_name?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          meeting_date?: string | null
          michicans_date?: string | null
          next_review_date?: string | null
          plan_type?: Database["public"]["Enums"]["care_plan_type"]
          recorder_name?: string | null
          review_frequency?: string | null
          signed_by?: string | null
          signed_date?: string | null
          status?: Database["public"]["Enums"]["care_plan_status"]
          template_id?: string | null
          template_version?: number | null
          training_version?: number
          version?: number
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          discharge_criteria?: string | null
          effective_date?: string | null
          expiration_date?: string | null
          facilitator_name?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          meeting_date?: string | null
          michicans_date?: string | null
          next_review_date?: string | null
          plan_type?: Database["public"]["Enums"]["care_plan_type"]
          recorder_name?: string | null
          review_frequency?: string | null
          signed_by?: string | null
          signed_date?: string | null
          status?: Database["public"]["Enums"]["care_plan_status"]
          template_id?: string | null
          template_version?: number | null
          training_version?: number
          version?: number
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plans_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      care_request_time_windows: {
        Row: {
          agency_id: string
          care_request_id: string
          created_at: string
          day_of_week: number
          earliest_start: string | null
          flexibility: string | null
          id: string
          is_demo: boolean
          latest_end: string | null
          min_duration_hours: number | null
          notes: string | null
          preferred_duration_hours: number | null
          preferred_end: string | null
          preferred_start: string | null
          updated_at: string
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          care_request_id: string
          created_at?: string
          day_of_week: number
          earliest_start?: string | null
          flexibility?: string | null
          id?: string
          is_demo?: boolean
          latest_end?: string | null
          min_duration_hours?: number | null
          notes?: string | null
          preferred_duration_hours?: number | null
          preferred_end?: string | null
          preferred_start?: string | null
          updated_at?: string
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          care_request_id?: string
          created_at?: string
          day_of_week?: number
          earliest_start?: string | null
          flexibility?: string | null
          id?: string
          is_demo?: boolean
          latest_end?: string | null
          min_duration_hours?: number | null
          notes?: string | null
          preferred_duration_hours?: number | null
          preferred_end?: string | null
          preferred_start?: string | null
          updated_at?: string
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_request_time_windows_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_request_time_windows_care_request_id_fkey"
            columns: ["care_request_id"]
            isOneToOne: false
            referencedRelation: "care_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_request_time_windows_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      care_requests: {
        Row: {
          agency_id: string
          care_type_codes: string[]
          client_id: string | null
          created_at: string
          created_by: string | null
          estimated_hours_per_week: number | null
          family_id: string | null
          flexibility: string | null
          id: string
          is_demo: boolean
          location_address: string | null
          location_city: string | null
          location_state: string | null
          location_zip_code: string | null
          notes: string | null
          priority: string
          recurrence_hint: string | null
          request_number: string | null
          requested_caregiver_id: string | null
          requested_end_date: string | null
          requested_end_time: string | null
          requested_start_date: string | null
          requested_start_time: string | null
          session_id: string | null
          source: string
          status: Database["public"]["Enums"]["care_request_status"]
          updated_at: string
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          care_type_codes?: string[]
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_hours_per_week?: number | null
          family_id?: string | null
          flexibility?: string | null
          id?: string
          is_demo?: boolean
          location_address?: string | null
          location_city?: string | null
          location_state?: string | null
          location_zip_code?: string | null
          notes?: string | null
          priority?: string
          recurrence_hint?: string | null
          request_number?: string | null
          requested_caregiver_id?: string | null
          requested_end_date?: string | null
          requested_end_time?: string | null
          requested_start_date?: string | null
          requested_start_time?: string | null
          session_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["care_request_status"]
          updated_at?: string
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          care_type_codes?: string[]
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          estimated_hours_per_week?: number | null
          family_id?: string | null
          flexibility?: string | null
          id?: string
          is_demo?: boolean
          location_address?: string | null
          location_city?: string | null
          location_state?: string | null
          location_zip_code?: string | null
          notes?: string | null
          priority?: string
          recurrence_hint?: string | null
          request_number?: string | null
          requested_caregiver_id?: string | null
          requested_end_date?: string | null
          requested_end_time?: string | null
          requested_start_date?: string | null
          requested_start_time?: string | null
          session_id?: string | null
          source?: string
          status?: Database["public"]["Enums"]["care_request_status"]
          updated_at?: string
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_requests_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_requests_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_requests_requested_caregiver_id_fkey"
            columns: ["requested_caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "care_requests_requested_caregiver_id_fkey"
            columns: ["requested_caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "conversation_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_requests_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      care_service_categories: {
        Row: {
          code_prefix: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
          weight_overrides: Json | null
        }
        Insert: {
          code_prefix?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
          weight_overrides?: Json | null
        }
        Update: {
          code_prefix?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          weight_overrides?: Json | null
        }
        Relationships: []
      }
      care_types: {
        Row: {
          category: string
          category_id: string | null
          code: string
          created_at: string | null
          description: string | null
          duration_hours: number | null
          id: string
          is_active: boolean | null
          keywords: string | null
          name: string
          price: number | null
          requires_trade_approval: boolean
          updated_at: string | null
          weight_overrides: Json | null
        }
        Insert: {
          category: string
          category_id?: string | null
          code: string
          created_at?: string | null
          description?: string | null
          duration_hours?: number | null
          id?: string
          is_active?: boolean | null
          keywords?: string | null
          name: string
          price?: number | null
          requires_trade_approval?: boolean
          updated_at?: string | null
          weight_overrides?: Json | null
        }
        Update: {
          category?: string
          category_id?: string | null
          code?: string
          created_at?: string | null
          description?: string | null
          duration_hours?: number | null
          id?: string
          is_active?: boolean | null
          keywords?: string | null
          name?: string
          price?: number | null
          requires_trade_approval?: boolean
          updated_at?: string | null
          weight_overrides?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "care_types_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "care_service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      caregiver_availability: {
        Row: {
          agency_id: string
          caregiver_id: string
          created_at: string | null
          day_of_week: number
          earliest_start: string | null
          end_time: string
          flexibility_minutes: number
          id: string
          is_available: boolean | null
          is_demo: boolean
          latest_end: string | null
          preferred_end: string | null
          preferred_start: string | null
          start_time: string
          updated_at: string | null
        }
        Insert: {
          agency_id: string
          caregiver_id: string
          created_at?: string | null
          day_of_week: number
          earliest_start?: string | null
          end_time: string
          flexibility_minutes?: number
          id?: string
          is_available?: boolean | null
          is_demo?: boolean
          latest_end?: string | null
          preferred_end?: string | null
          preferred_start?: string | null
          start_time: string
          updated_at?: string | null
        }
        Update: {
          agency_id?: string
          caregiver_id?: string
          created_at?: string | null
          day_of_week?: number
          earliest_start?: string | null
          end_time?: string
          flexibility_minutes?: number
          id?: string
          is_available?: boolean | null
          is_demo?: boolean
          latest_end?: string | null
          preferred_end?: string | null
          preferred_start?: string | null
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "caregiver_availability_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caregiver_availability_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "caregiver_availability_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
        ]
      }
      caregiver_availability_exceptions: {
        Row: {
          agency_id: string
          caregiver_id: string
          created_at: string
          end_time: string | null
          exception_date: string
          id: string
          is_available: boolean
          is_demo: boolean
          reason: string | null
          start_time: string | null
          updated_at: string
        }
        Insert: {
          agency_id: string
          caregiver_id: string
          created_at?: string
          end_time?: string | null
          exception_date: string
          id?: string
          is_available?: boolean
          is_demo?: boolean
          reason?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          agency_id?: string
          caregiver_id?: string
          created_at?: string
          end_time?: string | null
          exception_date?: string
          id?: string
          is_available?: boolean
          is_demo?: boolean
          reason?: string | null
          start_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "caregiver_availability_exceptions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caregiver_availability_exceptions_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "caregiver_availability_exceptions_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
        ]
      }
      caregiver_certifications: {
        Row: {
          caregiver_id: string
          certification_name: string
          certification_number: string | null
          change_history: Json
          created_at: string | null
          credential_type_id: string | null
          document_url: string | null
          effective_date: string | null
          entered_by: string | null
          expiry_date: string
          id: string
          is_demo: boolean
          is_verified: boolean | null
          issued_date: string | null
          overridden_at: string | null
          overridden_by: string | null
          updated_at: string | null
        }
        Insert: {
          caregiver_id: string
          certification_name: string
          certification_number?: string | null
          change_history?: Json
          created_at?: string | null
          credential_type_id?: string | null
          document_url?: string | null
          effective_date?: string | null
          entered_by?: string | null
          expiry_date: string
          id?: string
          is_demo?: boolean
          is_verified?: boolean | null
          issued_date?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
          updated_at?: string | null
        }
        Update: {
          caregiver_id?: string
          certification_name?: string
          certification_number?: string | null
          change_history?: Json
          created_at?: string | null
          credential_type_id?: string | null
          document_url?: string | null
          effective_date?: string | null
          entered_by?: string | null
          expiry_date?: string
          id?: string
          is_demo?: boolean
          is_verified?: boolean | null
          issued_date?: string | null
          overridden_at?: string | null
          overridden_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "caregiver_certifications_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "caregiver_certifications_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caregiver_certifications_credential_type_id_fkey"
            columns: ["credential_type_id"]
            isOneToOne: false
            referencedRelation: "credential_types"
            referencedColumns: ["id"]
          },
        ]
      }
      caregiver_preferences: {
        Row: {
          agency_id: string
          caregiver_id: string
          created_at: string
          desired_hourly_rate: number | null
          desired_weekly_earnings: number | null
          desired_weekly_hours: number | null
          flexibility: string
          id: string
          is_demo: boolean
          max_travel_miles: number | null
          max_travel_minutes: number | null
          max_weekly_hours: number | null
          min_weekly_hours: number | null
          notes: string | null
          open_to_short_notice: boolean
          preferred_care_type_codes: string[]
          preferred_cities: string[]
          preferred_days: number[]
          preferred_end_time: string | null
          preferred_start_time: string | null
          preferred_time_of_day: string[]
          preferred_zip_codes: string[]
          updated_at: string
          willing_to_travel_outside_area: boolean
        }
        Insert: {
          agency_id: string
          caregiver_id: string
          created_at?: string
          desired_hourly_rate?: number | null
          desired_weekly_earnings?: number | null
          desired_weekly_hours?: number | null
          flexibility?: string
          id?: string
          is_demo?: boolean
          max_travel_miles?: number | null
          max_travel_minutes?: number | null
          max_weekly_hours?: number | null
          min_weekly_hours?: number | null
          notes?: string | null
          open_to_short_notice?: boolean
          preferred_care_type_codes?: string[]
          preferred_cities?: string[]
          preferred_days?: number[]
          preferred_end_time?: string | null
          preferred_start_time?: string | null
          preferred_time_of_day?: string[]
          preferred_zip_codes?: string[]
          updated_at?: string
          willing_to_travel_outside_area?: boolean
        }
        Update: {
          agency_id?: string
          caregiver_id?: string
          created_at?: string
          desired_hourly_rate?: number | null
          desired_weekly_earnings?: number | null
          desired_weekly_hours?: number | null
          flexibility?: string
          id?: string
          is_demo?: boolean
          max_travel_miles?: number | null
          max_travel_minutes?: number | null
          max_weekly_hours?: number | null
          min_weekly_hours?: number | null
          notes?: string | null
          open_to_short_notice?: boolean
          preferred_care_type_codes?: string[]
          preferred_cities?: string[]
          preferred_days?: number[]
          preferred_end_time?: string | null
          preferred_start_time?: string | null
          preferred_time_of_day?: string[]
          preferred_zip_codes?: string[]
          updated_at?: string
          willing_to_travel_outside_area?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "caregiver_preferences_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caregiver_preferences_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: true
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "caregiver_preferences_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: true
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
        ]
      }
      caregiver_registrations: {
        Row: {
          address: string | null
          agency_id: string | null
          availability: Json | null
          care_type_codes: string[]
          city: string | null
          created_at: string | null
          email: string
          employment_type: string | null
          first_name: string
          hourly_rate: number | null
          id: string
          last_name: string
          notes: string | null
          phone: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state: string | null
          status: string | null
          updated_at: string | null
          virtual_office_id: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          agency_id?: string | null
          availability?: Json | null
          care_type_codes?: string[]
          city?: string | null
          created_at?: string | null
          email: string
          employment_type?: string | null
          first_name: string
          hourly_rate?: number | null
          id?: string
          last_name: string
          notes?: string | null
          phone: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string | null
          status?: string | null
          updated_at?: string | null
          virtual_office_id?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          agency_id?: string | null
          availability?: Json | null
          care_type_codes?: string[]
          city?: string | null
          created_at?: string | null
          email?: string
          employment_type?: string | null
          first_name?: string
          hourly_rate?: number | null
          id?: string
          last_name?: string
          notes?: string | null
          phone?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string | null
          status?: string | null
          updated_at?: string | null
          virtual_office_id?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "caregiver_registrations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caregiver_registrations_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      caregiver_skills: {
        Row: {
          care_type_code: string
          caregiver_id: string
          created_at: string | null
          id: string
          is_certified: boolean | null
          is_demo: boolean
          proficiency_level: string | null
          updated_at: string | null
          years_experience: number | null
        }
        Insert: {
          care_type_code: string
          caregiver_id: string
          created_at?: string | null
          id?: string
          is_certified?: boolean | null
          is_demo?: boolean
          proficiency_level?: string | null
          updated_at?: string | null
          years_experience?: number | null
        }
        Update: {
          care_type_code?: string
          caregiver_id?: string
          created_at?: string | null
          id?: string
          is_certified?: boolean | null
          is_demo?: boolean
          proficiency_level?: string | null
          updated_at?: string | null
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "caregiver_skills_care_type_code_fkey"
            columns: ["care_type_code"]
            isOneToOne: false
            referencedRelation: "care_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "caregiver_skills_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "caregiver_skills_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
        ]
      }
      caregivers: {
        Row: {
          address: string | null
          agency_id: string
          availability: Json | null
          city: string | null
          created_at: string | null
          custom_min_hours: number | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employment_type: string | null
          first_name: string
          hire_date: string | null
          hourly_rate: number | null
          id: string
          is_active: boolean | null
          is_demo: boolean
          last_name: string
          location_address: string | null
          location_city: string | null
          location_state: string | null
          location_zip_code: string | null
          performance_rating: number | null
          phone: string
          reliability_score: number | null
          role: Database["public"]["Enums"]["caregiver_role"]
          service_radius_miles: number | null
          service_zipcodes: string[] | null
          state: string | null
          updated_at: string | null
          user_id: string | null
          virtual_office_id: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          agency_id: string
          availability?: Json | null
          city?: string | null
          created_at?: string | null
          custom_min_hours?: number | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_type?: string | null
          first_name: string
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          last_name: string
          location_address?: string | null
          location_city?: string | null
          location_state?: string | null
          location_zip_code?: string | null
          performance_rating?: number | null
          phone: string
          reliability_score?: number | null
          role?: Database["public"]["Enums"]["caregiver_role"]
          service_radius_miles?: number | null
          service_zipcodes?: string[] | null
          state?: string | null
          updated_at?: string | null
          user_id?: string | null
          virtual_office_id?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          agency_id?: string
          availability?: Json | null
          city?: string | null
          created_at?: string | null
          custom_min_hours?: number | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employment_type?: string | null
          first_name?: string
          hire_date?: string | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          last_name?: string
          location_address?: string | null
          location_city?: string | null
          location_state?: string | null
          location_zip_code?: string | null
          performance_rating?: number | null
          phone?: string
          reliability_score?: number | null
          role?: Database["public"]["Enums"]["caregiver_role"]
          service_radius_miles?: number | null
          service_zipcodes?: string[] | null
          state?: string | null
          updated_at?: string | null
          user_id?: string | null
          virtual_office_id?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "caregivers_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caregivers_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
          weight_overrides: Json | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
          weight_overrides?: Json | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          weight_overrides?: Json | null
        }
        Relationships: []
      }
      client_care_needs: {
        Row: {
          care_type_code: string
          client_id: string
          created_at: string | null
          id: string
          is_demo: boolean
          notes: string | null
          priority: number | null
          updated_at: string | null
        }
        Insert: {
          care_type_code: string
          client_id: string
          created_at?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          priority?: number | null
          updated_at?: string | null
        }
        Update: {
          care_type_code?: string
          client_id?: string
          created_at?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          priority?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_care_needs_care_type_code_fkey"
            columns: ["care_type_code"]
            isOneToOne: false
            referencedRelation: "care_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "client_care_needs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_documents: {
        Row: {
          agency_id: string
          client_id: string
          created_at: string
          created_by: string | null
          doc_type: string
          effective_date: string | null
          expiration_date: string | null
          field_snapshot: Json | null
          field_values: Json
          file_ref: string | null
          id: string
          is_current: boolean
          not_applicable_reason: string | null
          status: Database["public"]["Enums"]["client_document_status"]
          template_id: string | null
          template_version: number | null
          version: number
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          doc_type: string
          effective_date?: string | null
          expiration_date?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          file_ref?: string | null
          id?: string
          is_current?: boolean
          not_applicable_reason?: string | null
          status?: Database["public"]["Enums"]["client_document_status"]
          template_id?: string | null
          template_version?: number | null
          version?: number
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          doc_type?: string
          effective_date?: string | null
          expiration_date?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          file_ref?: string | null
          id?: string
          is_current?: boolean
          not_applicable_reason?: string | null
          status?: Database["public"]["Enums"]["client_document_status"]
          template_id?: string | null
          template_version?: number | null
          version?: number
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_documents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      client_orders: {
        Row: {
          agency_id: string
          archived_at: string | null
          archived_by: string | null
          care_plan_id: string | null
          client_id: string
          created_at: string | null
          days_of_week: string | null
          duration_months: number | null
          end_date: string
          frequency: string
          id: string
          is_demo: boolean
          notes: string | null
          order_number: string
          start_date: string
          status: string | null
          updated_at: string | null
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          archived_at?: string | null
          archived_by?: string | null
          care_plan_id?: string | null
          client_id: string
          created_at?: string | null
          days_of_week?: string | null
          duration_months?: number | null
          end_date: string
          frequency?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          order_number?: string
          start_date: string
          status?: string | null
          updated_at?: string | null
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          archived_at?: string | null
          archived_by?: string | null
          care_plan_id?: string | null
          client_id?: string
          created_at?: string | null
          days_of_week?: string | null
          duration_months?: number | null
          end_date?: string
          frequency?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          order_number?: string
          start_date?: string
          status?: string | null
          updated_at?: string | null
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_orders_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_orders_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_orders_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      client_time_windows: {
        Row: {
          agency_id: string
          client_id: string
          created_at: string
          day_of_week: number
          earliest_start: string | null
          id: string
          is_demo: boolean
          latest_end: string | null
          min_duration_hours: number | null
          notes: string | null
          preferred_duration_hours: number | null
          preferred_end: string | null
          preferred_start: string | null
          updated_at: string
        }
        Insert: {
          agency_id: string
          client_id: string
          created_at?: string
          day_of_week: number
          earliest_start?: string | null
          id?: string
          is_demo?: boolean
          latest_end?: string | null
          min_duration_hours?: number | null
          notes?: string | null
          preferred_duration_hours?: number | null
          preferred_end?: string | null
          preferred_start?: string | null
          updated_at?: string
        }
        Update: {
          agency_id?: string
          client_id?: string
          created_at?: string
          day_of_week?: number
          earliest_start?: string | null
          id?: string
          is_demo?: boolean
          latest_end?: string | null
          min_duration_hours?: number | null
          notes?: string | null
          preferred_duration_hours?: number | null
          preferred_end?: string | null
          preferred_start?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_time_windows_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_time_windows_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string
          agency_id: string
          care_requirements: string[] | null
          case_number: string | null
          city: string
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          family_id: string | null
          first_name: string
          id: string
          is_active: boolean | null
          is_demo: boolean
          last_name: string
          medical_conditions: string[] | null
          notes: string | null
          phone: string
          preferred_caregiver_id: string | null
          scheduling_flexibility: string | null
          scheduling_notes: string | null
          state: string
          updated_at: string | null
          user_id: string | null
          virtual_office_id: string | null
          zip_code: string
        }
        Insert: {
          address: string
          agency_id: string
          care_requirements?: string[] | null
          case_number?: string | null
          city: string
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          family_id?: string | null
          first_name: string
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          last_name: string
          medical_conditions?: string[] | null
          notes?: string | null
          phone: string
          preferred_caregiver_id?: string | null
          scheduling_flexibility?: string | null
          scheduling_notes?: string | null
          state: string
          updated_at?: string | null
          user_id?: string | null
          virtual_office_id?: string | null
          zip_code: string
        }
        Update: {
          address?: string
          agency_id?: string
          care_requirements?: string[] | null
          case_number?: string | null
          city?: string
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          family_id?: string | null
          first_name?: string
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          last_name?: string
          medical_conditions?: string[] | null
          notes?: string | null
          phone?: string
          preferred_caregiver_id?: string | null
          scheduling_flexibility?: string | null
          scheduling_notes?: string | null
          state?: string
          updated_at?: string | null
          user_id?: string | null
          virtual_office_id?: string | null
          zip_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_preferred_caregiver_id_fkey"
            columns: ["preferred_caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "clients_preferred_caregiver_id_fkey"
            columns: ["preferred_caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_answers: {
        Row: {
          answered_at: string
          created_at: string
          dynamic_item_ids: Json
          free_text: string | null
          id: string
          is_active: boolean
          node_id: string
          option_ids: string[]
          option_labels: string[]
          score_delta: number
          sequence_index: number
          session_id: string
          skipped: boolean
          updated_at: string
        }
        Insert: {
          answered_at?: string
          created_at?: string
          dynamic_item_ids?: Json
          free_text?: string | null
          id?: string
          is_active?: boolean
          node_id: string
          option_ids?: string[]
          option_labels?: string[]
          score_delta?: number
          sequence_index: number
          session_id: string
          skipped?: boolean
          updated_at?: string
        }
        Update: {
          answered_at?: string
          created_at?: string
          dynamic_item_ids?: Json
          free_text?: string | null
          id?: string
          is_active?: boolean
          node_id?: string
          option_ids?: string[]
          option_labels?: string[]
          score_delta?: number
          sequence_index?: number
          session_id?: string
          skipped?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_answers_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "conversation_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_flows: {
        Row: {
          agency_id: string | null
          audience: Database["public"]["Enums"]["flow_audience"]
          created_at: string
          description: string | null
          draft_of: string | null
          entry_node_id: string | null
          id: string
          is_active: boolean
          name: string
          published_at: string | null
          review_threshold: number
          status: string
          strong_fit_threshold: number
          updated_at: string
          version: number
        }
        Insert: {
          agency_id?: string | null
          audience?: Database["public"]["Enums"]["flow_audience"]
          created_at?: string
          description?: string | null
          draft_of?: string | null
          entry_node_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          published_at?: string | null
          review_threshold?: number
          status?: string
          strong_fit_threshold?: number
          updated_at?: string
          version?: number
        }
        Update: {
          agency_id?: string | null
          audience?: Database["public"]["Enums"]["flow_audience"]
          created_at?: string
          description?: string | null
          draft_of?: string | null
          entry_node_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          published_at?: string | null
          review_threshold?: number
          status?: string
          strong_fit_threshold?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_flows_draft_of_fkey"
            columns: ["draft_of"]
            isOneToOne: false
            referencedRelation: "conversation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_flows_entry_node_fkey"
            columns: ["entry_node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_sessions: {
        Row: {
          agency_id: string | null
          band: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          completed_at: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_preference: string | null
          created_at: string
          current_node_id: string | null
          flow_id: string
          follow_up_status: string
          id: string
          registration_id: string | null
          session_token: string
          started_at: string
          status: Database["public"]["Enums"]["conversation_session_status"]
          submitted_at: string | null
          total_score: number
          trait_profile: Json
          trait_scores: Json
          updated_at: string
          user_id: string | null
        }
        Insert: {
          agency_id?: string | null
          band?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          completed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_preference?: string | null
          created_at?: string
          current_node_id?: string | null
          flow_id: string
          follow_up_status?: string
          id?: string
          registration_id?: string | null
          session_token: string
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_session_status"]
          submitted_at?: string | null
          total_score?: number
          trait_profile?: Json
          trait_scores?: Json
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          agency_id?: string | null
          band?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          completed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_preference?: string | null
          created_at?: string
          current_node_id?: string | null
          flow_id?: string
          follow_up_status?: string
          id?: string
          registration_id?: string | null
          session_token?: string
          started_at?: string
          status?: Database["public"]["Enums"]["conversation_session_status"]
          submitted_at?: string | null
          total_score?: number
          trait_profile?: Json
          trait_scores?: Json
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_sessions_current_node_id_fkey"
            columns: ["current_node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_sessions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "conversation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_sessions_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "caregiver_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      cp_default_credential_types: {
        Row: {
          category: Database["public"]["Enums"]["credential_category"]
          id: string
          is_active: boolean
          name: string
          required: boolean
          valid_months: number | null
        }
        Insert: {
          category: Database["public"]["Enums"]["credential_category"]
          id?: string
          is_active?: boolean
          name: string
          required?: boolean
          valid_months?: number | null
        }
        Update: {
          category?: Database["public"]["Enums"]["credential_category"]
          id?: string
          is_active?: boolean
          name?: string
          required?: boolean
          valid_months?: number | null
        }
        Relationships: []
      }
      cp_default_service_types: {
        Row: {
          care_type_code: string
          id: string
          is_active: boolean
          service_type: string
        }
        Insert: {
          care_type_code: string
          id?: string
          is_active?: boolean
          service_type: string
        }
        Update: {
          care_type_code?: string
          id?: string
          is_active?: boolean
          service_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cp_default_service_types_care_type_code_fkey"
            columns: ["care_type_code"]
            isOneToOne: true
            referencedRelation: "care_types"
            referencedColumns: ["code"]
          },
        ]
      }
      credential_types: {
        Row: {
          agency_id: string
          category: Database["public"]["Enums"]["credential_category"]
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          required: boolean
          valid_months: number | null
        }
        Insert: {
          agency_id: string
          category: Database["public"]["Enums"]["credential_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          required?: boolean
          valid_months?: number | null
        }
        Update: {
          agency_id?: string
          category?: Database["public"]["Enums"]["credential_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          required?: boolean
          valid_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_types_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_purge_audit: {
        Row: {
          dry_run: boolean
          id: string
          ran_at: string
          result: Json
        }
        Insert: {
          dry_run?: boolean
          id?: string
          ran_at?: string
          result: Json
        }
        Update: {
          dry_run?: boolean
          id?: string
          ran_at?: string
          result?: Json
        }
        Relationships: []
      }
      earnings_lines: {
        Row: {
          agency_id: string
          caregiver_id: string
          computed_at: string
          computed_by: string | null
          created_at: string
          gross_amount: number
          hours_used: number
          id: string
          is_demo: boolean
          overtime_amount: number
          overtime_hours: number
          overtime_rate: number | null
          rate_source: Database["public"]["Enums"]["earnings_rate_source"]
          rate_used: number
          regular_amount: number
          regular_hours: number
          shift_assignment_id: string
          shift_id: string
          status: Database["public"]["Enums"]["earnings_line_status"]
          time_entry_id: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          caregiver_id: string
          computed_at?: string
          computed_by?: string | null
          created_at?: string
          gross_amount?: number
          hours_used: number
          id?: string
          is_demo?: boolean
          overtime_amount?: number
          overtime_hours?: number
          overtime_rate?: number | null
          rate_source: Database["public"]["Enums"]["earnings_rate_source"]
          rate_used: number
          regular_amount?: number
          regular_hours?: number
          shift_assignment_id: string
          shift_id: string
          status?: Database["public"]["Enums"]["earnings_line_status"]
          time_entry_id: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          caregiver_id?: string
          computed_at?: string
          computed_by?: string | null
          created_at?: string
          gross_amount?: number
          hours_used?: number
          id?: string
          is_demo?: boolean
          overtime_amount?: number
          overtime_hours?: number
          overtime_rate?: number | null
          rate_source?: Database["public"]["Enums"]["earnings_rate_source"]
          rate_used?: number
          regular_amount?: number
          regular_hours?: number
          shift_assignment_id?: string
          shift_id?: string
          status?: Database["public"]["Enums"]["earnings_line_status"]
          time_entry_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "earnings_lines_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_lines_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "earnings_lines_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_lines_shift_assignment_id_fkey"
            columns: ["shift_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_lines_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "earnings_lines_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor_id: string | null
          actor_type: string
          agency_id: string
          created_at: string
          event_type: string
          id: string
          is_demo: boolean
          occurred_at: string
          payload: Json
          subject_id: string | null
          subject_type: string
          virtual_office_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          agency_id: string
          created_at?: string
          event_type: string
          id?: string
          is_demo?: boolean
          occurred_at?: string
          payload?: Json
          subject_id?: string | null
          subject_type: string
          virtual_office_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          agency_id?: string
          created_at?: string
          event_type?: string
          id?: string
          is_demo?: boolean
          occurred_at?: string
          payload?: Json
          subject_id?: string | null
          subject_type?: string
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          agency_id: string
          created_at: string
          family_name: string
          id: string
          is_active: boolean
          is_demo: boolean
          notes: string | null
          updated_at: string
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          family_name: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          notes?: string | null
          updated_at?: string
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          family_name?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          notes?: string | null
          updated_at?: string
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "families_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "families_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      family_contacts: {
        Row: {
          created_at: string
          email: string | null
          family_id: string
          first_name: string
          id: string
          is_decision_maker: boolean
          is_demo: boolean
          is_primary: boolean
          last_name: string
          phone: string | null
          relationship: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          family_id: string
          first_name: string
          id?: string
          is_decision_maker?: boolean
          is_demo?: boolean
          is_primary?: boolean
          last_name: string
          phone?: string | null
          relationship?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          family_id?: string
          first_name?: string
          id?: string
          is_decision_maker?: boolean
          is_demo?: boolean
          is_primary?: boolean
          last_name?: string
          phone?: string | null
          relationship?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_contacts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_nodes: {
        Row: {
          allow_free_text: boolean
          allow_skip: boolean
          created_at: string
          default_next_node_id: string | null
          default_weights: Json
          dynamic_source_table: string | null
          flow_id: string
          free_text_label: string | null
          helper_text: string | null
          id: string
          node_key: string
          node_type: Database["public"]["Enums"]["flow_node_type"]
          prompt: string
          sort_order: number
          sub_question_template: string | null
          updated_at: string
        }
        Insert: {
          allow_free_text?: boolean
          allow_skip?: boolean
          created_at?: string
          default_next_node_id?: string | null
          default_weights?: Json
          dynamic_source_table?: string | null
          flow_id: string
          free_text_label?: string | null
          helper_text?: string | null
          id?: string
          node_key: string
          node_type?: Database["public"]["Enums"]["flow_node_type"]
          prompt: string
          sort_order?: number
          sub_question_template?: string | null
          updated_at?: string
        }
        Update: {
          allow_free_text?: boolean
          allow_skip?: boolean
          created_at?: string
          default_next_node_id?: string | null
          default_weights?: Json
          dynamic_source_table?: string | null
          flow_id?: string
          free_text_label?: string | null
          helper_text?: string | null
          id?: string
          node_key?: string
          node_type?: Database["public"]["Enums"]["flow_node_type"]
          prompt?: string
          sort_order?: number
          sub_question_template?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_nodes_default_next_fkey"
            columns: ["default_next_node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_nodes_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "conversation_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_options: {
        Row: {
          created_at: string
          id: string
          label: string
          next_node_id: string | null
          node_id: string
          score_weight: number
          sort_order: number
          trait_tag: string | null
          trait_weights: Json
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          next_node_id?: string | null
          node_id: string
          score_weight?: number
          sort_order?: number
          trait_tag?: string | null
          trait_weights?: Json
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          next_node_id?: string | null
          node_id?: string
          score_weight?: number
          sort_order?: number
          trait_tag?: string | null
          trait_weights?: Json
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_options_next_node_id_fkey"
            columns: ["next_node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_options_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "flow_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      form_template_fields: {
        Row: {
          default_value: string | null
          field_key: string
          field_type: string
          id: string
          label: string
          options: Json | null
          required: boolean
          section: string | null
          shown_on_progress_note: boolean
          sort_order: number
          storage: Database["public"]["Enums"]["form_field_storage"]
          template_version_id: string
          writes_to_column: string | null
          writes_to_entity: string | null
        }
        Insert: {
          default_value?: string | null
          field_key: string
          field_type: string
          id?: string
          label: string
          options?: Json | null
          required?: boolean
          section?: string | null
          shown_on_progress_note?: boolean
          sort_order?: number
          storage: Database["public"]["Enums"]["form_field_storage"]
          template_version_id: string
          writes_to_column?: string | null
          writes_to_entity?: string | null
        }
        Update: {
          default_value?: string | null
          field_key?: string
          field_type?: string
          id?: string
          label?: string
          options?: Json | null
          required?: boolean
          section?: string | null
          shown_on_progress_note?: boolean
          sort_order?: number
          storage?: Database["public"]["Enums"]["form_field_storage"]
          template_version_id?: string
          writes_to_column?: string | null
          writes_to_entity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_template_fields_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "form_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_current: boolean
          note_layout: Json | null
          published_at: string | null
          published_by: string | null
          sections: Json
          status: Database["public"]["Enums"]["form_template_version_status"]
          template_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_current?: boolean
          note_layout?: Json | null
          published_at?: string | null
          published_by?: string | null
          sections?: Json
          status?: Database["public"]["Enums"]["form_template_version_status"]
          template_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_current?: boolean
          note_layout?: Json | null
          published_at?: string | null
          published_by?: string | null
          sections?: Json
          status?: Database["public"]["Enums"]["form_template_version_status"]
          template_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_templates: {
        Row: {
          agency_id: string
          created_at: string
          created_by: string | null
          id: string
          intake_doc_type: string | null
          is_active: boolean
          is_required_for_client: boolean
          kind: Database["public"]["Enums"]["form_template_kind"]
          name: string
          service_type: string | null
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          intake_doc_type?: string | null
          is_active?: boolean
          is_required_for_client?: boolean
          kind: Database["public"]["Enums"]["form_template_kind"]
          name: string
          service_type?: string | null
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          intake_doc_type?: string | null
          is_active?: boolean
          is_required_for_client?: boolean
          kind?: Database["public"]["Enums"]["form_template_kind"]
          name?: string
          service_type?: string | null
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_templates_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      group_sessions: {
        Row: {
          agency_id: string
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          max_clients: number | null
          session_date: string
          staff_client_ratio: string | null
          start_time: string
          virtual_office_id: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          max_clients?: number | null
          session_date: string
          staff_client_ratio?: string | null
          start_time: string
          virtual_office_id: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          max_clients?: number | null
          session_date?: string
          staff_client_ratio?: string | null
          start_time?: string
          virtual_office_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_sessions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_sessions_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          is_demo: boolean
          language: string
          search_vector: unknown
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          is_demo?: boolean
          language: string
          search_vector?: unknown
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          is_demo?: boolean
          language?: string
          search_vector?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_language_fkey"
            columns: ["document_id", "language"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id", "language"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          agency_id: string
          category: string | null
          content: string
          created_at: string
          created_by: string | null
          file_format: string | null
          id: string
          ingestion_error: string | null
          ingestion_status: string
          is_active: boolean
          is_demo: boolean
          language: string
          source_storage_path: string | null
          superseded_by: string | null
          surface: string
          title: string
          updated_at: string
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          category?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          file_format?: string | null
          id?: string
          ingestion_error?: string | null
          ingestion_status?: string
          is_active?: boolean
          is_demo?: boolean
          language?: string
          source_storage_path?: string | null
          superseded_by?: string | null
          surface?: string
          title: string
          updated_at?: string
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          file_format?: string | null
          id?: string
          ingestion_error?: string | null
          ingestion_status?: string
          is_active?: boolean
          is_demo?: boolean
          language?: string
          source_storage_path?: string | null
          superseded_by?: string | null
          surface?: string
          title?: string
          updated_at?: string
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      measure_types: {
        Row: {
          agency_id: string | null
          created_at: string
          created_by: string | null
          default_options: Json | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["measure_kind"]
          label: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          created_by?: string | null
          default_options?: Json | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["measure_kind"]
          label: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          created_by?: string | null
          default_options?: Json | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["measure_kind"]
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "measure_types_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
        ]
      }
      objective_measures: {
        Row: {
          id: string
          is_active: boolean
          measure_type_id: string
          objective_id: string
          options: Json | null
          prompt_text: string
          seq: number
          trial_count: number | null
        }
        Insert: {
          id?: string
          is_active?: boolean
          measure_type_id: string
          objective_id: string
          options?: Json | null
          prompt_text: string
          seq?: number
          trial_count?: number | null
        }
        Update: {
          id?: string
          is_active?: boolean
          measure_type_id?: string
          objective_id?: string
          options?: Json | null
          prompt_text?: string
          seq?: number
          trial_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "objective_measures_measure_type_id_fkey"
            columns: ["measure_type_id"]
            isOneToOne: false
            referencedRelation: "measure_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objective_measures_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "care_plan_objectives"
            referencedColumns: ["id"]
          },
        ]
      }
      office_service_types: {
        Row: {
          agency_id: string
          care_type_code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          service_type: string
          virtual_office_id: string
        }
        Insert: {
          agency_id: string
          care_type_code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          service_type: string
          virtual_office_id: string
        }
        Update: {
          agency_id?: string
          care_type_code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          service_type?: string
          virtual_office_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "office_service_types_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "office_service_types_care_type_code_fkey"
            columns: ["care_type_code"]
            isOneToOne: false
            referencedRelation: "care_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "office_service_types_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      order_services: {
        Row: {
          care_type_code: string
          created_at: string
          days_of_week: number[]
          end_time: string
          frequency: string
          id: string
          is_active: boolean
          is_demo: boolean
          notes: string | null
          order_id: string
          service_authorization_id: string | null
          start_time: string
          updated_at: string
          week_of_month: number | null
        }
        Insert: {
          care_type_code: string
          created_at?: string
          days_of_week?: number[]
          end_time: string
          frequency?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          notes?: string | null
          order_id: string
          service_authorization_id?: string | null
          start_time: string
          updated_at?: string
          week_of_month?: number | null
        }
        Update: {
          care_type_code?: string
          created_at?: string
          days_of_week?: number[]
          end_time?: string
          frequency?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          notes?: string | null
          order_id?: string
          service_authorization_id?: string | null
          start_time?: string
          updated_at?: string
          week_of_month?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_services_care_type_code_fkey"
            columns: ["care_type_code"]
            isOneToOne: false
            referencedRelation: "care_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "order_services_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "client_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_services_service_authorization_id_fkey"
            columns: ["service_authorization_id"]
            isOneToOne: false
            referencedRelation: "service_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_notifications: {
        Row: {
          agency_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          payload: Json
          recipient_email: string
          recipient_name: string | null
          sent_at: string | null
          subject: string
          updated_at: string
        }
        Insert: {
          agency_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          recipient_email: string
          recipient_name?: string | null
          sent_at?: string | null
          subject: string
          updated_at?: string
        }
        Update: {
          agency_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          recipient_email?: string
          recipient_name?: string | null
          sent_at?: string | null
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_notifications_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_inservice_forms: {
        Row: {
          agency_id: string
          care_plan_id: string
          case_manager_name: string | null
          client_id: string
          created_at: string
          entered_by: string | null
          field_snapshot: Json | null
          field_values: Json
          id: string
          program_lead_id: string | null
          signed_at: string | null
          template_id: string | null
          template_version: number | null
          trained_on: string | null
          training_version: number
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          care_plan_id: string
          case_manager_name?: string | null
          client_id: string
          created_at?: string
          entered_by?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          program_lead_id?: string | null
          signed_at?: string | null
          template_id?: string | null
          template_version?: number | null
          trained_on?: string | null
          training_version: number
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          care_plan_id?: string
          case_manager_name?: string | null
          client_id?: string
          created_at?: string
          entered_by?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          program_lead_id?: string | null
          signed_at?: string | null
          template_id?: string | null
          template_version?: number | null
          trained_on?: string | null
          training_version?: number
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_inservice_forms_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_inservice_forms_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_inservice_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_inservice_forms_program_lead_id_fkey"
            columns: ["program_lead_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_inservice_forms_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_inservice_forms_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_training_forms: {
        Row: {
          agency_id: string
          care_plan_id: string
          client_id: string
          created_at: string
          entered_by: string | null
          field_snapshot: Json | null
          field_values: Json
          id: string
          location: string | null
          plan_document_type: Database["public"]["Enums"]["plan_document_type"]
          plan_effective_date: string | null
          template_id: string | null
          template_version: number | null
          training_version: number
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          care_plan_id: string
          client_id: string
          created_at?: string
          entered_by?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          location?: string | null
          plan_document_type?: Database["public"]["Enums"]["plan_document_type"]
          plan_effective_date?: string | null
          template_id?: string | null
          template_version?: number | null
          training_version: number
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          care_plan_id?: string
          client_id?: string
          created_at?: string
          entered_by?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          location?: string | null
          plan_document_type?: Database["public"]["Enums"]["plan_document_type"]
          plan_effective_date?: string | null
          template_id?: string | null
          template_version?: number | null
          training_version?: number
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_training_forms_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_training_forms_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_training_forms_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_training_forms_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_training_forms_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_training_records: {
        Row: {
          agency_id: string
          care_plan_id: string
          caregiver_id: string
          change_history: Json
          client_id: string
          created_at: string
          entered_by: string | null
          id: string
          overridden_at: string | null
          overridden_by: string | null
          primary_clinician_name: string | null
          signed_date: string | null
          trainer_name: string | null
          training_date: string | null
          training_form_id: string
          training_method: Database["public"]["Enums"]["training_method"] | null
          training_version: number
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          care_plan_id: string
          caregiver_id: string
          change_history?: Json
          client_id: string
          created_at?: string
          entered_by?: string | null
          id?: string
          overridden_at?: string | null
          overridden_by?: string | null
          primary_clinician_name?: string | null
          signed_date?: string | null
          trainer_name?: string | null
          training_date?: string | null
          training_form_id: string
          training_method?:
            | Database["public"]["Enums"]["training_method"]
            | null
          training_version: number
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          care_plan_id?: string
          caregiver_id?: string
          change_history?: Json
          client_id?: string
          created_at?: string
          entered_by?: string | null
          id?: string
          overridden_at?: string | null
          overridden_by?: string | null
          primary_clinician_name?: string | null
          signed_date?: string | null
          trainer_name?: string | null
          training_date?: string | null
          training_form_id?: string
          training_method?:
            | Database["public"]["Enums"]["training_method"]
            | null
          training_version?: number
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_training_records_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_training_records_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_training_records_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "plan_training_records_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_training_records_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_training_records_training_form_id_fkey"
            columns: ["training_form_id"]
            isOneToOne: false
            referencedRelation: "plan_training_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_training_records_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          agency_id: string | null
          business_license: string | null
          created_at: string | null
          default_ft_min_hours: number | null
          default_pt_min_hours: number | null
          email: string
          full_name: string | null
          id: string
          office_restricted: boolean
          overtime_threshold: number | null
          phone: string | null
          subscription_tier: string | null
          updated_at: string | null
          virtual_office_id: string | null
        }
        Insert: {
          agency_id?: string | null
          business_license?: string | null
          created_at?: string | null
          default_ft_min_hours?: number | null
          default_pt_min_hours?: number | null
          email: string
          full_name?: string | null
          id: string
          office_restricted?: boolean
          overtime_threshold?: number | null
          phone?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string | null
          business_license?: string | null
          created_at?: string | null
          default_ft_min_hours?: number | null
          default_pt_min_hours?: number | null
          email?: string
          full_name?: string | null
          id?: string
          office_restricted?: boolean
          overtime_threshold?: number | null
          phone?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_note_entries: {
        Row: {
          data: Json
          id: string
          measures_snapshot: Json | null
          notes_text: string | null
          objective_id: string | null
          progress_note_id: string
        }
        Insert: {
          data?: Json
          id?: string
          measures_snapshot?: Json | null
          notes_text?: string | null
          objective_id?: string | null
          progress_note_id: string
        }
        Update: {
          data?: Json
          id?: string
          measures_snapshot?: Json | null
          notes_text?: string | null
          objective_id?: string | null
          progress_note_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "progress_note_entries_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "care_plan_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_note_entries_progress_note_id_fkey"
            columns: ["progress_note_id"]
            isOneToOne: false
            referencedRelation: "progress_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      progress_notes: {
        Row: {
          actual_end: string | null
          actual_minutes: number | null
          agency_id: string
          arrived_late: boolean
          authorization_id: string | null
          batch_approved_at: string | null
          batch_approved_by: string | null
          billable: boolean
          billed_at: string | null
          biller_name: string | null
          biller_signed_at: string | null
          billing_batch_id: string | null
          care_plan_id: string | null
          caregiver_id: string
          client_arrived_at: string | null
          client_id: string
          completed_on: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          field_snapshot: Json | null
          field_values: Json
          id: string
          late_submitted: boolean
          location: string | null
          narrative_text: string | null
          non_billable_reason: string | null
          note_kind: Database["public"]["Enums"]["progress_note_kind"]
          returned_at: string | null
          returned_by: string | null
          returned_count: number
          returned_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          service_date: string
          service_type: string | null
          shift_id: string | null
          staff_client_ratio: string | null
          staff_signature_name: string | null
          staff_signed_at: string | null
          status: Database["public"]["Enums"]["progress_note_status"]
          template_id: string | null
          template_version: number | null
          training_version: number | null
          units_scheduled: number | null
          units_used: number
          virtual_office_id: string | null
          void_reason: string | null
          voided: boolean
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          actual_end?: string | null
          actual_minutes?: number | null
          agency_id: string
          arrived_late?: boolean
          authorization_id?: string | null
          batch_approved_at?: string | null
          batch_approved_by?: string | null
          billable?: boolean
          billed_at?: string | null
          biller_name?: string | null
          biller_signed_at?: string | null
          billing_batch_id?: string | null
          care_plan_id?: string | null
          caregiver_id: string
          client_arrived_at?: string | null
          client_id: string
          completed_on?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          late_submitted?: boolean
          location?: string | null
          narrative_text?: string | null
          non_billable_reason?: string | null
          note_kind: Database["public"]["Enums"]["progress_note_kind"]
          returned_at?: string | null
          returned_by?: string | null
          returned_count?: number
          returned_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          service_date: string
          service_type?: string | null
          shift_id?: string | null
          staff_client_ratio?: string | null
          staff_signature_name?: string | null
          staff_signed_at?: string | null
          status?: Database["public"]["Enums"]["progress_note_status"]
          template_id?: string | null
          template_version?: number | null
          training_version?: number | null
          units_scheduled?: number | null
          units_used?: number
          virtual_office_id?: string | null
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          actual_end?: string | null
          actual_minutes?: number | null
          agency_id?: string
          arrived_late?: boolean
          authorization_id?: string | null
          batch_approved_at?: string | null
          batch_approved_by?: string | null
          billable?: boolean
          billed_at?: string | null
          biller_name?: string | null
          biller_signed_at?: string | null
          billing_batch_id?: string | null
          care_plan_id?: string | null
          caregiver_id?: string
          client_arrived_at?: string | null
          client_id?: string
          completed_on?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          late_submitted?: boolean
          location?: string | null
          narrative_text?: string | null
          non_billable_reason?: string | null
          note_kind?: Database["public"]["Enums"]["progress_note_kind"]
          returned_at?: string | null
          returned_by?: string | null
          returned_count?: number
          returned_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          service_date?: string
          service_type?: string | null
          shift_id?: string | null
          staff_client_ratio?: string | null
          staff_signature_name?: string | null
          staff_signed_at?: string | null
          status?: Database["public"]["Enums"]["progress_note_status"]
          template_id?: string | null
          template_version?: number | null
          training_version?: number | null
          units_scheduled?: number | null
          units_used?: number
          virtual_office_id?: string | null
          void_reason?: string | null
          voided?: boolean
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "progress_notes_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_notes_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "service_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_notes_billing_batch_id_fkey"
            columns: ["billing_batch_id"]
            isOneToOne: false
            referencedRelation: "billing_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_notes_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_notes_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "progress_notes_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_notes_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_notes_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progress_notes_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_create: boolean | null
          can_delete: boolean | null
          can_read: boolean | null
          can_update: boolean | null
          created_at: string | null
          id: string
          module_code: string
          role_code: Database["public"]["Enums"]["app_role"]
          updated_at: string | null
        }
        Insert: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_read?: boolean | null
          can_update?: boolean | null
          created_at?: string | null
          id?: string
          module_code: string
          role_code: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
        }
        Update: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_read?: boolean | null
          can_update?: boolean | null
          created_at?: string | null
          id?: string
          module_code?: string
          role_code?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_module_code_fkey"
            columns: ["module_code"]
            isOneToOne: false
            referencedRelation: "system_modules"
            referencedColumns: ["module_code"]
          },
        ]
      }
      service_authorizations: {
        Row: {
          agency_id: string
          amount: number | null
          auth_number: string
          authorizing_agent_notes: string | null
          client_id: string
          created_at: string
          created_by: string | null
          effective_date: string
          expiration_date: string
          field_snapshot: Json | null
          field_values: Json
          id: string
          modifier: string | null
          period_type: Database["public"]["Enums"]["auth_period_type"] | null
          rate: number | null
          service_code: string | null
          service_description: string | null
          service_type: string
          source_adapter: Database["public"]["Enums"]["auth_source_type"]
          template_id: string | null
          template_version: number | null
          unit_minutes: number
          units_authorized: number
          units_available: number
          units_claimed: number
          units_paid: number
          units_per_period: number | null
          units_used_before_caremuch: number
          virtual_office_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          agency_id: string
          amount?: number | null
          auth_number: string
          authorizing_agent_notes?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          effective_date: string
          expiration_date: string
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          modifier?: string | null
          period_type?: Database["public"]["Enums"]["auth_period_type"] | null
          rate?: number | null
          service_code?: string | null
          service_description?: string | null
          service_type: string
          source_adapter?: Database["public"]["Enums"]["auth_source_type"]
          template_id?: string | null
          template_version?: number | null
          unit_minutes?: number
          units_authorized?: number
          units_available?: number
          units_claimed?: number
          units_paid?: number
          units_per_period?: number | null
          units_used_before_caremuch?: number
          virtual_office_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          agency_id?: string
          amount?: number | null
          auth_number?: string
          authorizing_agent_notes?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string
          expiration_date?: string
          field_snapshot?: Json | null
          field_values?: Json
          id?: string
          modifier?: string | null
          period_type?: Database["public"]["Enums"]["auth_period_type"] | null
          rate?: number | null
          service_code?: string | null
          service_description?: string | null
          service_type?: string
          source_adapter?: Database["public"]["Enums"]["auth_source_type"]
          template_id?: string | null
          template_version?: number | null
          unit_minutes?: number
          units_authorized?: number
          units_available?: number
          units_claimed?: number
          units_paid?: number
          units_per_period?: number | null
          units_used_before_caremuch?: number
          virtual_office_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_authorizations_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_authorizations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_authorizations_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_authorizations_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_assignments: {
        Row: {
          actual_hours_worked: number | null
          assigned_at: string | null
          assignment_method: Database["public"]["Enums"]["assignment_method"]
          caregiver_id: string
          clock_in_location: string | null
          clock_in_time: string | null
          clock_out_location: string | null
          clock_out_time: string | null
          created_at: string | null
          id: string
          is_demo: boolean
          is_locked: boolean | null
          mileage: number | null
          notes: string | null
          override_at: string | null
          override_by: string | null
          override_reason: string | null
          shift_id: string
          status: Database["public"]["Enums"]["assignment_status"]
          updated_at: string | null
        }
        Insert: {
          actual_hours_worked?: number | null
          assigned_at?: string | null
          assignment_method?: Database["public"]["Enums"]["assignment_method"]
          caregiver_id: string
          clock_in_location?: string | null
          clock_in_time?: string | null
          clock_out_location?: string | null
          clock_out_time?: string | null
          created_at?: string | null
          id?: string
          is_demo?: boolean
          is_locked?: boolean | null
          mileage?: number | null
          notes?: string | null
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string | null
        }
        Update: {
          actual_hours_worked?: number | null
          assigned_at?: string | null
          assignment_method?: Database["public"]["Enums"]["assignment_method"]
          caregiver_id?: string
          clock_in_location?: string | null
          clock_in_time?: string | null
          clock_out_location?: string | null
          clock_out_time?: string | null
          created_at?: string | null
          id?: string
          is_demo?: boolean
          is_locked?: boolean | null
          mileage?: number | null
          notes?: string | null
          override_at?: string | null
          override_by?: string | null
          override_reason?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "shift_assignments_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_ratings: {
        Row: {
          agency_id: string
          caregiver_id: string
          client_id: string
          comment: string | null
          created_at: string
          created_by: string | null
          id: string
          is_demo: boolean
          rating: number
          shift_id: string
          updated_at: string
        }
        Insert: {
          agency_id: string
          caregiver_id: string
          client_id: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          rating: number
          shift_id: string
          updated_at?: string
        }
        Update: {
          agency_id?: string
          caregiver_id?: string
          client_id?: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_demo?: boolean
          rating?: number
          shift_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_ratings_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "shift_ratings_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_ratings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_ratings_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_trades: {
        Row: {
          approval_reasons: string[]
          auto_approved: boolean
          created_at: string | null
          decided_by: string | null
          decision_notes: string | null
          eligibility_snapshot: Json | null
          id: string
          is_demo: boolean
          new_caregiver_id: string | null
          original_caregiver_id: string
          reason: string | null
          requires_manager_approval: boolean
          resolved_at: string | null
          shift_assignment_id: string
          shift_id: string | null
          status: Database["public"]["Enums"]["trade_status"]
          surge_pay_amount: number | null
          trade_type: Database["public"]["Enums"]["trade_type"]
          updated_at: string
        }
        Insert: {
          approval_reasons?: string[]
          auto_approved?: boolean
          created_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          eligibility_snapshot?: Json | null
          id?: string
          is_demo?: boolean
          new_caregiver_id?: string | null
          original_caregiver_id: string
          reason?: string | null
          requires_manager_approval?: boolean
          resolved_at?: string | null
          shift_assignment_id: string
          shift_id?: string | null
          status?: Database["public"]["Enums"]["trade_status"]
          surge_pay_amount?: number | null
          trade_type?: Database["public"]["Enums"]["trade_type"]
          updated_at?: string
        }
        Update: {
          approval_reasons?: string[]
          auto_approved?: boolean
          created_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          eligibility_snapshot?: Json | null
          id?: string
          is_demo?: boolean
          new_caregiver_id?: string | null
          original_caregiver_id?: string
          reason?: string | null
          requires_manager_approval?: boolean
          resolved_at?: string | null
          shift_assignment_id?: string
          shift_id?: string | null
          status?: Database["public"]["Enums"]["trade_status"]
          surge_pay_amount?: number | null
          trade_type?: Database["public"]["Enums"]["trade_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_trades_new_caregiver_id_fkey"
            columns: ["new_caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "shift_trades_new_caregiver_id_fkey"
            columns: ["new_caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_original_caregiver_id_fkey"
            columns: ["original_caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "shift_trades_original_caregiver_id_fkey"
            columns: ["original_caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_shift_assignment_id_fkey"
            columns: ["shift_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_trades_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          agency_id: string
          care_request_id: string | null
          care_type_code: string
          caregiver_id: string | null
          client_id: string
          created_at: string | null
          duration_hours: number
          end_time: string
          group_session_id: string | null
          id: string
          is_demo: boolean
          is_recurring: boolean | null
          order_id: string | null
          order_service_id: string | null
          order_title: string
          pay_rate: number | null
          recurrence_pattern: string | null
          required_skills: string[] | null
          shift_date: string
          special_instructions: string | null
          special_notes: string | null
          start_time: string
          status: Database["public"]["Enums"]["shift_status"] | null
          updated_at: string | null
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          care_request_id?: string | null
          care_type_code: string
          caregiver_id?: string | null
          client_id: string
          created_at?: string | null
          duration_hours: number
          end_time: string
          group_session_id?: string | null
          id?: string
          is_demo?: boolean
          is_recurring?: boolean | null
          order_id?: string | null
          order_service_id?: string | null
          order_title?: string
          pay_rate?: number | null
          recurrence_pattern?: string | null
          required_skills?: string[] | null
          shift_date: string
          special_instructions?: string | null
          special_notes?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["shift_status"] | null
          updated_at?: string | null
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          care_request_id?: string | null
          care_type_code?: string
          caregiver_id?: string | null
          client_id?: string
          created_at?: string | null
          duration_hours?: number
          end_time?: string
          group_session_id?: string | null
          id?: string
          is_demo?: boolean
          is_recurring?: boolean | null
          order_id?: string | null
          order_service_id?: string | null
          order_title?: string
          pay_rate?: number | null
          recurrence_pattern?: string | null
          required_skills?: string[] | null
          shift_date?: string
          special_instructions?: string | null
          special_notes?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["shift_status"] | null
          updated_at?: string | null
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_care_request_id_fkey"
            columns: ["care_request_id"]
            isOneToOne: false
            referencedRelation: "care_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_care_type_code_fkey"
            columns: ["care_type_code"]
            isOneToOne: false
            referencedRelation: "care_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "shifts_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "shifts_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_group_session_id_fkey"
            columns: ["group_session_id"]
            isOneToOne: false
            referencedRelation: "group_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "client_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_order_service_id_fkey"
            columns: ["order_service_id"]
            isOneToOne: false
            referencedRelation: "order_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      system_modules: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          module_code: string
          module_name: string
          updated_at: string | null
        }
        Insert: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          module_code: string
          module_name: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          module_code?: string
          module_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      system_roles: {
        Row: {
          access_level: number
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          role_code: Database["public"]["Enums"]["app_role"]
          role_name: string
          updated_at: string | null
        }
        Insert: {
          access_level?: number
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          role_code: Database["public"]["Enums"]["app_role"]
          role_name: string
          updated_at?: string | null
        }
        Update: {
          access_level?: number
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          role_code?: Database["public"]["Enums"]["app_role"]
          role_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          agency_id: string
          approved_at: string | null
          approved_by: string | null
          break_minutes: number
          caregiver_id: string
          created_at: string
          created_by: string | null
          ended_at: string
          hours_worked: number
          id: string
          is_demo: boolean
          mileage: number | null
          notes: string | null
          shift_assignment_id: string
          shift_id: string
          source: Database["public"]["Enums"]["time_entry_source"]
          started_at: string
          status: Database["public"]["Enums"]["time_entry_status"]
          updated_at: string
          virtual_office_id: string | null
          voided_at: string | null
        }
        Insert: {
          agency_id: string
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          caregiver_id: string
          created_at?: string
          created_by?: string | null
          ended_at: string
          hours_worked: number
          id?: string
          is_demo?: boolean
          mileage?: number | null
          notes?: string | null
          shift_assignment_id: string
          shift_id: string
          source?: Database["public"]["Enums"]["time_entry_source"]
          started_at: string
          status?: Database["public"]["Enums"]["time_entry_status"]
          updated_at?: string
          virtual_office_id?: string | null
          voided_at?: string | null
        }
        Update: {
          agency_id?: string
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          caregiver_id?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string
          hours_worked?: number
          id?: string
          is_demo?: boolean
          mileage?: number | null
          notes?: string | null
          shift_assignment_id?: string
          shift_id?: string
          source?: Database["public"]["Enums"]["time_entry_source"]
          started_at?: string
          status?: Database["public"]["Enums"]["time_entry_status"]
          updated_at?: string
          virtual_office_id?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "time_entries_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_shift_assignment_id_fkey"
            columns: ["shift_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      time_off_requests: {
        Row: {
          agency_id: string
          approved_by_user_id: string | null
          caregiver_id: string
          created_at: string | null
          end_date: string
          id: string
          is_demo: boolean
          notes: string | null
          reason: string | null
          request_type: Database["public"]["Enums"]["request_type"]
          start_date: string
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string | null
          virtual_office_id: string | null
        }
        Insert: {
          agency_id: string
          approved_by_user_id?: string | null
          caregiver_id: string
          created_at?: string | null
          end_date: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          reason?: string | null
          request_type: Database["public"]["Enums"]["request_type"]
          start_date: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string | null
          virtual_office_id?: string | null
        }
        Update: {
          agency_id?: string
          approved_by_user_id?: string | null
          caregiver_id?: string
          created_at?: string | null
          end_date?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          reason?: string | null
          request_type?: Database["public"]["Enums"]["request_type"]
          start_date?: string
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string | null
          virtual_office_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_off_requests_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregiver_performance"
            referencedColumns: ["caregiver_id"]
          },
          {
            foreignKeyName: "time_off_requests_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "caregivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_off_requests_virtual_office_id_fkey"
            columns: ["virtual_office_id"]
            isOneToOne: false
            referencedRelation: "virtual_office"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          agency_id: string | null
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
        ]
      }
      virtual_office: {
        Row: {
          address: string | null
          agency_id: string
          billing_week_start: number
          branding: Json
          care_plan_module_enabled: boolean
          care_plan_module_enabled_at: string | null
          city: string | null
          code: string | null
          compliance_enforcement_enabled: boolean
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          group_session_max_clients: number
          id: string
          is_active: boolean
          is_demo: boolean
          is_primary: boolean
          late_trade_hours: number | null
          max_weekly_hours: number | null
          name: string
          operating_hours: Json
          public_content: Json
          service_area: Json
          service_states: string[]
          service_zipcodes: string[]
          slug: string | null
          smart_match_weights: Json | null
          state: string | null
          timezone: string
          travel_buffer_minutes: number | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          agency_id: string
          billing_week_start?: number
          branding?: Json
          care_plan_module_enabled?: boolean
          care_plan_module_enabled_at?: string | null
          city?: string | null
          code?: string | null
          compliance_enforcement_enabled?: boolean
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          group_session_max_clients?: number
          id?: string
          is_active?: boolean
          is_demo?: boolean
          is_primary?: boolean
          late_trade_hours?: number | null
          max_weekly_hours?: number | null
          name: string
          operating_hours?: Json
          public_content?: Json
          service_area?: Json
          service_states?: string[]
          service_zipcodes?: string[]
          slug?: string | null
          smart_match_weights?: Json | null
          state?: string | null
          timezone?: string
          travel_buffer_minutes?: number | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          agency_id?: string
          billing_week_start?: number
          branding?: Json
          care_plan_module_enabled?: boolean
          care_plan_module_enabled_at?: string | null
          city?: string | null
          code?: string | null
          compliance_enforcement_enabled?: boolean
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          group_session_max_clients?: number
          id?: string
          is_active?: boolean
          is_demo?: boolean
          is_primary?: boolean
          late_trade_hours?: number | null
          max_weekly_hours?: number | null
          name?: string
          operating_hours?: Json
          public_content?: Json
          service_area?: Json
          service_states?: string[]
          service_zipcodes?: string[]
          slug?: string | null
          smart_match_weights?: Json | null
          state?: string | null
          timezone?: string
          travel_buffer_minutes?: number | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "virtual_office_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      caregiver_performance: {
        Row: {
          agency_id: string | null
          avg_rating: number | null
          avg_rating_90d: number | null
          caregiver_id: string | null
          completion_rate: number | null
          hours_last_30d: number | null
          lifetime_cancelled: number | null
          lifetime_completed: number | null
          lifetime_hours: number | null
          lifetime_no_shows: number | null
          on_time_rate: number | null
          rating_count: number | null
          rating_count_90d: number | null
          shifts_last_30d: number | null
        }
        Relationships: [
          {
            foreignKeyName: "caregivers_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      approve_batch_notes: {
        Args: { _batch_id: string; _note_ids: string[] }
        Returns: Json
      }
      approve_clean_rows: { Args: { _batch_id: string }; Returns: Json }
      assign_caregiver_role: {
        Args: { caregiver_email: string }
        Returns: undefined
      }
      assign_caregiver_to_shift: {
        Args: {
          _caregiver_id: string
          _method?: Database["public"]["Enums"]["assignment_method"]
          _notes?: string
          _override_reason?: string
          _shift_id: string
        }
        Returns: Json
      }
      build_billing_batch: {
        Args: { _office_id: string; _week_start: string }
        Returns: Json
      }
      caregiver_agency_id: { Args: { _caregiver_id: string }; Returns: string }
      caregiver_pick_up_shift: { Args: { _shift_id: string }; Returns: Json }
      caregiver_pickup_trade_shift: {
        Args: { _trade_id: string }
        Returns: Json
      }
      check_assignment_eligibility: {
        Args: { _caregiver_id: string; _shift_id: string }
        Returns: Json
      }
      check_assignment_eligibility_bulk: {
        Args: { _caregiver_ids: string[]; _shift_id: string }
        Returns: {
          caregiver_id: string
          result: Json
        }[]
      }
      check_caregiver_shifts_eligibility: {
        Args: { _shift_ids: string[] }
        Returns: {
          result: Json
          shift_id: string
        }[]
      }
      compute_earnings_batch: {
        Args: {
          _agency_id: string
          _from: string
          _recompute?: boolean
          _to: string
        }
        Returns: Json
      }
      compute_earnings_for_time_entry: {
        Args: { _recompute?: boolean; _time_entry_id: string }
        Returns: Json
      }
      convert_care_request_to_client: {
        Args: {
          p_address?: string
          p_care_type_codes?: string[]
          p_city?: string
          p_email?: string
          p_existing_client_id?: string
          p_family_name?: string
          p_first_name?: string
          p_last_name?: string
          p_phone?: string
          p_request_id: string
          p_state?: string
          p_zip_code?: string
        }
        Returns: Json
      }
      correct_service_authorization: {
        Args: { _changes: Json; _id: string; _reason: string }
        Returns: Json
      }
      cp_approve_batch: {
        Args: { _batch_id: string; _clean_only: boolean; _note_ids: string[] }
        Returns: Json
      }
      cp_audit: {
        Args: {
          _agency_id: string
          _event_type: string
          _office_id: string
          _payload: Json
          _subject_id: string
          _subject_type: string
        }
        Returns: undefined
      }
      cp_authorization_projection: {
        Args: { _as_of: string; _client_id: string; _service_type: string }
        Returns: Json
      }
      cp_care_plan_goal_in_scope: {
        Args: { _goal_id: string }
        Returns: boolean
      }
      cp_care_plan_in_scope: {
        Args: { _care_plan_id: string }
        Returns: boolean
      }
      cp_care_plan_objective_in_scope: {
        Args: { _objective_id: string }
        Returns: boolean
      }
      cp_caregiver_safe_eligibility: { Args: { _elig: Json }; Returns: Json }
      cp_check_constrained_edit: {
        Args: { _current_version_id: string; _fields: Json; _note_layout: Json }
        Returns: undefined
      }
      cp_client_onboarding: { Args: { _client_id: string }; Returns: Json }
      cp_eligibility_core: {
        Args: { _caregiver_id: string; _ctx: Json; _shift_id: string }
        Returns: Json
      }
      cp_form_template_readable: {
        Args: { _template_id: string }
        Returns: boolean
      }
      cp_form_template_version_readable: {
        Args: { _version_id: string }
        Returns: boolean
      }
      cp_goal_tree: { Args: { _care_plan_id: string }; Returns: Json }
      cp_is_assigned_caregiver: {
        Args: { _caregiver_id: string }
        Returns: boolean
      }
      cp_lock_client_authorizations: {
        Args: { _client_id: string }
        Returns: undefined
      }
      cp_objective_measures: { Args: { _objective_id: string }; Returns: Json }
      cp_office_note_queue: {
        Args: { _office_id: string }
        Returns: {
          arrived_late: boolean
          caregiver_id: string
          client_id: string
          due_at: string
          group_session: boolean
          in_batch: boolean
          note_id: string
          overdue: boolean
          returned_count: number
          reviewed_at: string
          scheduled_end: string
          scheduled_start: string
          service_date: string
          service_type: string
          shift_id: string
          status: string
          submitted_at: string
          units_scheduled: number
          units_used: number
        }[]
      }
      cp_period_left: {
        Args: {
          _auth: string
          _cap: number
          _d: string
          _dm_auth: string[]
          _dm_date: string[]
          _dm_units: number[]
          _period: Database["public"]["Enums"]["auth_period_type"]
          _week_start: number
        }
        Returns: number
      }
      cp_period_window: {
        Args: {
          _d: string
          _period: Database["public"]["Enums"]["auth_period_type"]
          _week_start: number
        }
        Returns: unknown
      }
      cp_plan_row_spec: { Args: { _entity: string }; Returns: Json }
      cp_progress_note_in_scope: {
        Args: { _note_id: string }
        Returns: boolean
      }
      cp_projected_units: {
        Args: {
          _client_id: string
          _exclude_shift: string
          _need: number
          _service_type: string
          _shift_date: string
        }
        Returns: Json
      }
      cp_require_agency_measure_type: {
        Args: { _id: string }
        Returns: {
          agency_id: string | null
          created_at: string
          created_by: string | null
          default_options: Json | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["measure_kind"]
          label: string
        }
        SetofOptions: {
          from: "*"
          to: "measure_types"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cp_require_scope: {
        Args: {
          _agency_id: string
          _office_id: string
          _roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: undefined
      }
      cp_require_template_editor: {
        Args: { _agency_id: string; _office_id: string }
        Returns: undefined
      }
      cp_resolve_note_template: {
        Args: { _agency_id: string; _office_id: string; _service_type: string }
        Returns: string
      }
      cp_resolve_template: {
        Args: {
          _agency_id: string
          _intake_doc_type: string
          _kind: Database["public"]["Enums"]["form_template_kind"]
          _office_id: string
        }
        Returns: string
      }
      cp_safe_issue_list: { Args: { _issues: Json }; Returns: Json }
      cp_shift_client_context: { Args: { _shift_id: string }; Returns: Json }
      cp_shift_units: {
        Args: { _date: string; _end: string; _start: string; _tz: string }
        Returns: number
      }
      cp_spine_columns: { Args: { _entity: string }; Returns: string[] }
      cp_staff_in_agency: {
        Args: {
          _agency_id: string
          _roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: boolean
      }
      cp_staff_in_scope: {
        Args: {
          _agency_id: string
          _office_id: string
          _roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: boolean
      }
      cp_template_snapshot: { Args: { _version_id: string }; Returns: Json }
      cp_validate_answer: {
        Args: { _a: Json; _final: boolean; _m: Json }
        Returns: undefined
      }
      cp_validate_entry_data: {
        Args: { _data: Json; _final: boolean; _measures: Json }
        Returns: undefined
      }
      cp_validate_field_values: {
        Args: { _snapshot: Json; _values: Json }
        Returns: undefined
      }
      cp_validate_plan_header: {
        Args: { _h: Json; _require_dates: boolean }
        Returns: undefined
      }
      cp_validate_template_definition: {
        Args: {
          _fields: Json
          _kind: Database["public"]["Enums"]["form_template_kind"]
          _note_layout: Json
        }
        Returns: undefined
      }
      create_care_plan: {
        Args: {
          _client_id: string
          _field_values?: Json
          _header: Json
          _plan_type: Database["public"]["Enums"]["care_plan_type"]
        }
        Returns: string
      }
      create_flow_draft: { Args: { p_flow_id: string }; Returns: string }
      create_group_session: {
        Args: {
          _end_time: string
          _max_clients?: number
          _office_id: string
          _session_date: string
          _staff_client_ratio?: string
          _start_time: string
        }
        Returns: string
      }
      create_progress_note_for_shift: {
        Args: { _shift_id: string }
        Returns: string
      }
      create_service_authorization: {
        Args: {
          _auth_number: string
          _authorizing_agent_notes?: string
          _client_id: string
          _effective_date: string
          _expiration_date: string
          _field_values?: Json
          _modifier?: string
          _period_type?: Database["public"]["Enums"]["auth_period_type"]
          _service_code?: string
          _service_description?: string
          _service_type: string
          _unit_minutes?: number
          _units_authorized: number
          _units_per_period?: number
          _units_used_before_caremuch?: number
        }
        Returns: string
      }
      current_agency_id: { Args: never; Returns: string }
      current_virtual_office_id: { Args: never; Returns: string }
      delete_measure_type: { Args: { _id: string }; Returns: undefined }
      derived_shift_caregiver: { Args: { _shift_id: string }; Returns: string }
      discard_flow_draft: { Args: { p_draft_id: string }; Returns: undefined }
      enter_caregiver_credential: {
        Args: {
          _caregiver_id: string
          _certification_number?: string
          _credential_type_id: string
          _effective_date: string
          _expiry_date: string
        }
        Returns: string
      }
      event_actor_type: { Args: never; Returns: string }
      event_default_agency_id: { Args: never; Returns: string }
      family_agency_id: { Args: { _family_id: string }; Returns: string }
      flow_session_complete: {
        Args: {
          p_band: string
          p_contact_email?: string
          p_contact_name?: string
          p_contact_phone?: string
          p_session_id: string
          p_token: string
          p_total_score: number
          p_trait_scores: Json
        }
        Returns: undefined
      }
      flow_session_link_registration: {
        Args: {
          p_registration_id: string
          p_session_id: string
          p_token: string
        }
        Returns: undefined
      }
      flow_session_progress: {
        Args: { p_node_id: string; p_session_id: string; p_token: string }
        Returns: undefined
      }
      flow_session_submit_intake: {
        Args: {
          p_agency_id?: string
          p_email: string
          p_name: string
          p_phone: string
          p_preference: string
          p_session_id: string
          p_token: string
          p_total_score?: number
          p_trait_scores?: Json
          p_virtual_office_id?: string
        }
        Returns: undefined
      }
      flow_session_trim_answers: {
        Args: {
          p_from_index: number
          p_node_id: string
          p_session_id: string
          p_token: string
        }
        Returns: undefined
      }
      generate_order_number: { Args: never; Returns: string }
      get_billing_batch: { Args: { _batch_id: string }; Returns: Json }
      get_billing_week: {
        Args: { _office_id: string; _week_start?: string }
        Returns: Json
      }
      get_bookable_caregivers: {
        Args: { _day_of_week: number }
        Returns: {
          avg_rating: number
          care_type_codes: string[]
          caregiver_id: string
          day_windows: Json
          first_name: string
          last_initial: string
          rating_count: number
        }[]
      }
      get_caregiver_clock: { Args: never; Returns: Json }
      get_caregiver_compliance: {
        Args: { _caregiver_id: string }
        Returns: Json
      }
      get_caregiver_trade_shifts: {
        Args: never
        Returns: {
          care_type_code: string
          client_id: string
          duration_hours: number
          end_time: string
          order_title: string
          original_caregiver_first_name: string
          original_caregiver_last_name: string
          reason: string
          shift_date: string
          shift_id: string
          start_time: string
          trade_id: string
        }[]
      }
      get_caregiver_visible_clients: {
        Args: never
        Returns: {
          address: string
          city: string
          first_name: string
          id: string
          last_name: string
          phone: string
          scheduling_flexibility: string
          state: string
          zip_code: string
        }[]
      }
      get_caregiver_with_profile: {
        Args: { caregiver_uuid: string }
        Returns: {
          agency_id: string
          email: string
          full_name: string
          hourly_rate: number
          id: string
          is_active: boolean
          performance_rating: number
          phone: string
          role: Database["public"]["Enums"]["caregiver_role"]
          user_id: string
        }[]
      }
      get_client_authorizations: { Args: { _client_id: string }; Returns: Json }
      get_client_onboarding_status: {
        Args: { _client_id: string }
        Returns: Json
      }
      get_client_training_context: {
        Args: { _client_id: string }
        Returns: Json
      }
      get_client_with_profile: {
        Args: { client_uuid: string }
        Returns: {
          address: string
          agency_id: string
          city: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          medical_conditions: string[]
          phone: string
          state: string
          user_id: string
        }[]
      }
      get_enforcement_readiness: {
        Args: { _days?: number; _office_id: string }
        Returns: Json
      }
      get_my_care_team: {
        Args: never
        Returns: {
          avg_rating: number
          care_type_codes: string[]
          caregiver_id: string
          employment_role: string
          first_name: string
          is_preferred: boolean
          last_initial: string
          last_shift_date: string
          next_shift_date: string
          rating_count: number
          shift_count: number
        }[]
      }
      get_my_trade_requests: {
        Args: never
        Returns: {
          created_at: string
          end_time: string
          id: string
          new_caregiver_first_name: string
          new_caregiver_last_initial: string
          order_title: string
          reason: string
          resolved_at: string
          shift_date: string
          shift_id: string
          start_time: string
          status: string
        }[]
      }
      get_notes_review_counts: { Args: never; Returns: Json }
      get_progress_note_for_caregiver: {
        Args: { _note_id: string }
        Returns: Json
      }
      get_progress_note_for_staff: { Args: { _note_id: string }; Returns: Json }
      get_public_office: { Args: { p_slug: string }; Returns: Json }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_permission: {
        Args: {
          _module_code: string
          _permission_type: string
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_agency_staff: { Args: { _user_id: string }; Returns: boolean }
      is_my_assigned_shift: { Args: { _shift_id: string }; Returns: boolean }
      is_office_restricted: { Args: { _user_id: string }; Returns: boolean }
      is_published_public_agency: {
        Args: { _agency_id: string }
        Returns: boolean
      }
      knowledge_document_agency_id: {
        Args: { _document_id: string }
        Returns: string
      }
      list_authorization_risk: {
        Args: { _office_id: string; _within_days?: number }
        Returns: Json
      }
      list_billing_week_status: { Args: never; Returns: Json }
      list_caregivers_needing_retraining: {
        Args: { _office_id: string }
        Returns: Json
      }
      list_client_training_status: {
        Args: { _office_id: string }
        Returns: Json
      }
      list_clients_onboarding: { Args: { _office_id: string }; Returns: Json }
      list_credential_expirations: {
        Args: { _office_id: string; _within_days?: number }
        Returns: Json
      }
      list_my_notes_due: { Args: never; Returns: Json }
      list_notes_for_review: { Args: { _office_id: string }; Returns: Json }
      list_overdue_notes: {
        Args: { _as_of?: string; _office_id: string }
        Returns: Json
      }
      list_templates_with_usage: { Args: { _office_id: string }; Returns: Json }
      log_event: {
        Args: {
          _actor_id?: string
          _actor_type?: string
          _agency_id: string
          _event_type: string
          _is_demo?: boolean
          _payload?: Json
          _subject_id?: string
          _subject_type?: string
          _virtual_office_id?: string
        }
        Returns: undefined
      }
      mark_batch_billed: { Args: { _batch_id: string }; Returns: Json }
      match_agency_knowledge: {
        Args: {
          _agency_id?: string
          _language: string
          _limit?: number
          _match_threshold?: number
          _query_embedding: string
          _surfaces?: string[]
          _virtual_office_id?: string
        }
        Returns: {
          chunk_id: string
          content: string
          document_id: string
          document_title: string
          similarity: number
        }[]
      }
      my_agency_id: { Args: never; Returns: string }
      my_caregiver_ids: { Args: never; Returns: string[] }
      my_client_ids: { Args: never; Returns: string[] }
      order_agency_id: { Args: { _order_id: string }; Returns: string }
      order_client_id: { Args: { _order_id: string }; Returns: string }
      override_training_record: {
        Args: {
          _primary_clinician_name: string
          _record_id: string
          _signed_date: string
          _trainer_name: string
          _training_date: string
          _training_method: Database["public"]["Enums"]["training_method"]
        }
        Returns: undefined
      }
      publish_flow_draft: { Args: { p_draft_id: string }; Returns: string }
      publish_template_version: {
        Args: { _template_id: string }
        Returns: string
      }
      purge_demo_data: { Args: never; Returns: Json }
      purge_demo_data_dry_run: { Args: never; Returns: Json }
      record_inservice_form: {
        Args: {
          _care_plan_id: string
          _case_manager_name: string
          _field_values?: Json
          _program_lead_id: string
          _signed_at: string
          _trained_on: string
        }
        Returns: string
      }
      record_training_form: {
        Args: {
          _care_plan_id: string
          _field_values?: Json
          _location: string
          _plan_document_type: Database["public"]["Enums"]["plan_document_type"]
          _plan_effective_date: string
          _records: Json
        }
        Returns: string
      }
      release_shift_assignments: {
        Args: { _reason?: string; _shift_ids: string[] }
        Returns: number
      }
      renew_care_plan: {
        Args: {
          _care_plan_id: string
          _field_values?: Json
          _header?: Json
          _plan_type?: Database["public"]["Enums"]["care_plan_type"]
        }
        Returns: string
      }
      return_progress_note: {
        Args: { _note_id: string; _reason: string }
        Returns: undefined
      }
      review_progress_note: {
        Args: {
          _billable: boolean
          _non_billable_reason?: string
          _note_id: string
        }
        Returns: Json
      }
      save_progress_note_draft: {
        Args: {
          _entries?: Json
          _header?: Json
          _narrative_text?: string
          _note_id: string
        }
        Returns: undefined
      }
      save_template_draft: {
        Args: {
          _fields: Json
          _intake_doc_type: string
          _is_required_for_client: boolean
          _kind: Database["public"]["Enums"]["form_template_kind"]
          _name: string
          _note_layout: Json
          _office_id: string
          _sections: Json
          _service_type?: string
          _template_id: string
        }
        Returns: string
      }
      search_agency_knowledge: {
        Args: {
          _agency_id?: string
          _language: string
          _limit?: number
          _query: string
          _surfaces?: string[]
          _virtual_office_id?: string
        }
        Returns: {
          chunk_id: string
          content: string
          document_id: string
          document_title: string
          rank: number
        }[]
      }
      seed_office_care_plan_defaults: {
        Args: { _office_id: string }
        Returns: Json
      }
      set_care_plan_rows: {
        Args: { _care_plan_id: string; _entity: string; _rows: Json }
        Returns: number
      }
      set_compliance_enforcement: {
        Args: { _enabled: boolean; _office_id: string }
        Returns: Json
      }
      set_measure_type_active: {
        Args: { _active: boolean; _id: string }
        Returns: undefined
      }
      set_objective_measures: {
        Args: { _measures: Json; _objective_id: string }
        Returns: number
      }
      set_shift_group_session: {
        Args: { _group_session_id: string; _shift_id: string }
        Returns: undefined
      }
      shift_assignment_agency_id: {
        Args: { _shift_id: string }
        Returns: string
      }
      shift_assignment_virtual_office_id: {
        Args: { _shift_id: string }
        Returns: string
      }
      submit_caregiver_registration: {
        Args: {
          p_address?: string
          p_agency_id?: string
          p_care_type_codes?: string[]
          p_city?: string
          p_email: string
          p_employment_type?: string
          p_first_name: string
          p_hourly_rate?: number
          p_last_name: string
          p_phone: string
          p_state?: string
          p_virtual_office_id?: string
          p_zip_code?: string
        }
        Returns: string
      }
      submit_progress_note: {
        Args: { _note_id: string; _typed_signature: string }
        Returns: Json
      }
      update_care_plan_fields: {
        Args: { _care_plan_id: string; _field_values?: Json; _header?: Json }
        Returns: undefined
      }
      upgrade_instance_template: {
        Args: {
          _instance_id: string
          _instance_table: string
          _new_values?: Json
        }
        Returns: Json
      }
      upsert_care_plan_goals: {
        Args: { _care_plan_id: string; _goals: Json }
        Returns: Json
      }
      upsert_client_document: {
        Args: {
          _client_id: string
          _doc_type: string
          _effective_date?: string
          _expiration_date?: string
          _field_values?: Json
          _file_ref?: string
          _not_applicable_reason?: string
          _status: Database["public"]["Enums"]["client_document_status"]
        }
        Returns: string
      }
      upsert_measure_type: {
        Args: {
          _default_options?: Json
          _id: string
          _kind: Database["public"]["Enums"]["measure_kind"]
          _label: string
        }
        Returns: string
      }
      void_progress_note: {
        Args: { _note_id: string; _reason: string }
        Returns: undefined
      }
      void_service_authorization: {
        Args: { _id: string; _reason: string }
        Returns: Json
      }
      would_bump_training_version: {
        Args: { _care_plan_id: string; _goals: Json }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "system_admin"
        | "agency_admin"
        | "manager"
        | "scheduler"
        | "hr_staff"
        | "caregiver"
        | "client"
      assignment_method:
        | "manual"
        | "ai_suggested"
        | "auto_assigned"
        | "traded"
        | "picked_up"
      assignment_status:
        | "scheduled"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "no_show"
        | "cancelled"
      auth_period_type:
        | "per_week"
        | "per_auth"
        | "per_quarter"
        | "per_month"
        | "per_day"
      auth_source_type: "manual" | "doc" | "edi" | "connector"
      billing_batch_status: "open" | "reviewed" | "billed"
      care_plan_status: "active" | "superseded" | "expired"
      care_plan_type: "initial" | "annual" | "addendum"
      care_request_status:
        | "new"
        | "reviewing"
        | "matched"
        | "scheduled"
        | "fulfilled"
        | "cancelled"
      care_type:
        | "personal_care"
        | "companionship"
        | "medication"
        | "mobility"
        | "dementia_care"
        | "hospice"
      caregiver_role: "full_time" | "part_time" | "on_call"
      client_document_status:
        | "missing"
        | "pending"
        | "complete"
        | "expired"
        | "not_applicable"
      conversation_session_status:
        | "in_progress"
        | "completed"
        | "abandoned"
        | "submitted"
      credential_category:
        | "background_check"
        | "annual_online"
        | "annual"
        | "in_person_recert"
      earnings_line_status: "calculated" | "voided"
      earnings_rate_source: "shift" | "caregiver"
      flow_audience: "caregiver_screening" | "family_intake" | "general"
      flow_node_type:
        | "single_select"
        | "multi_select"
        | "info"
        | "contact_capture"
        | "terminal"
      form_field_storage:
        | "spine_column"
        | "child_rows"
        | "field_value"
        | "static_text"
      form_template_kind:
        | "ipos"
        | "authorization"
        | "progress_note"
        | "inservice"
        | "training"
        | "intake"
        | "credential"
      form_template_version_status: "draft" | "published"
      measure_kind:
        | "yes_no_na"
        | "prompt_level"
        | "graded_steps"
        | "tally"
        | "trials"
        | "short_answer"
        | "narrative"
        | "staff_note"
      objective_responsible_party:
        | "this_agency"
        | "case_management"
        | "evaluator"
        | "family"
        | "other_provider"
      plan_document_type:
        | "ipos_initial"
        | "ipos_annual"
        | "ipos_addendum"
        | "behavior_support_plan"
        | "protocol"
      progress_note_kind: "cls" | "respite"
      progress_note_status:
        | "draft"
        | "submitted"
        | "returned"
        | "reviewed"
        | "billed"
      request_status: "pending" | "approved" | "denied" | "cancelled"
      request_type: "vacation" | "medical" | "personal" | "emergency"
      shift_status:
        | "open"
        | "assigned"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "unassigned"
      time_entry_source: "clock" | "manual" | "correction" | "import"
      time_entry_status: "draft" | "submitted" | "approved" | "rejected"
      trade_status:
        | "pending"
        | "accepted"
        | "declined"
        | "cancelled"
        | "expired"
      trade_type: "trade_board" | "direct_trade" | "agency_coverage"
      training_method: "pcp_meeting" | "outside_pcp"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "system_admin",
        "agency_admin",
        "manager",
        "scheduler",
        "hr_staff",
        "caregiver",
        "client",
      ],
      assignment_method: [
        "manual",
        "ai_suggested",
        "auto_assigned",
        "traded",
        "picked_up",
      ],
      assignment_status: [
        "scheduled",
        "confirmed",
        "in_progress",
        "completed",
        "no_show",
        "cancelled",
      ],
      auth_period_type: [
        "per_week",
        "per_auth",
        "per_quarter",
        "per_month",
        "per_day",
      ],
      auth_source_type: ["manual", "doc", "edi", "connector"],
      billing_batch_status: ["open", "reviewed", "billed"],
      care_plan_status: ["active", "superseded", "expired"],
      care_plan_type: ["initial", "annual", "addendum"],
      care_request_status: [
        "new",
        "reviewing",
        "matched",
        "scheduled",
        "fulfilled",
        "cancelled",
      ],
      care_type: [
        "personal_care",
        "companionship",
        "medication",
        "mobility",
        "dementia_care",
        "hospice",
      ],
      caregiver_role: ["full_time", "part_time", "on_call"],
      client_document_status: [
        "missing",
        "pending",
        "complete",
        "expired",
        "not_applicable",
      ],
      conversation_session_status: [
        "in_progress",
        "completed",
        "abandoned",
        "submitted",
      ],
      credential_category: [
        "background_check",
        "annual_online",
        "annual",
        "in_person_recert",
      ],
      earnings_line_status: ["calculated", "voided"],
      earnings_rate_source: ["shift", "caregiver"],
      flow_audience: ["caregiver_screening", "family_intake", "general"],
      flow_node_type: [
        "single_select",
        "multi_select",
        "info",
        "contact_capture",
        "terminal",
      ],
      form_field_storage: [
        "spine_column",
        "child_rows",
        "field_value",
        "static_text",
      ],
      form_template_kind: [
        "ipos",
        "authorization",
        "progress_note",
        "inservice",
        "training",
        "intake",
        "credential",
      ],
      form_template_version_status: ["draft", "published"],
      measure_kind: [
        "yes_no_na",
        "prompt_level",
        "graded_steps",
        "tally",
        "trials",
        "short_answer",
        "narrative",
        "staff_note",
      ],
      objective_responsible_party: [
        "this_agency",
        "case_management",
        "evaluator",
        "family",
        "other_provider",
      ],
      plan_document_type: [
        "ipos_initial",
        "ipos_annual",
        "ipos_addendum",
        "behavior_support_plan",
        "protocol",
      ],
      progress_note_kind: ["cls", "respite"],
      progress_note_status: [
        "draft",
        "submitted",
        "returned",
        "reviewed",
        "billed",
      ],
      request_status: ["pending", "approved", "denied", "cancelled"],
      request_type: ["vacation", "medical", "personal", "emergency"],
      shift_status: [
        "open",
        "assigned",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
        "unassigned",
      ],
      time_entry_source: ["clock", "manual", "correction", "import"],
      time_entry_status: ["draft", "submitted", "approved", "rejected"],
      trade_status: ["pending", "accepted", "declined", "cancelled", "expired"],
      trade_type: ["trade_board", "direct_trade", "agency_coverage"],
      training_method: ["pcp_meeting", "outside_pcp"],
    },
  },
} as const
