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
          created_at: string | null
          document_url: string | null
          expiry_date: string
          id: string
          is_demo: boolean
          is_verified: boolean | null
          issued_date: string | null
          updated_at: string | null
        }
        Insert: {
          caregiver_id: string
          certification_name: string
          certification_number?: string | null
          created_at?: string | null
          document_url?: string | null
          expiry_date: string
          id?: string
          is_demo?: boolean
          is_verified?: boolean | null
          issued_date?: string | null
          updated_at?: string | null
        }
        Update: {
          caregiver_id?: string
          certification_name?: string
          certification_number?: string | null
          created_at?: string | null
          document_url?: string | null
          expiry_date?: string
          id?: string
          is_demo?: boolean
          is_verified?: boolean | null
          issued_date?: string | null
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
      client_orders: {
        Row: {
          agency_id: string
          archived_at: string | null
          archived_by: string | null
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
        }
        Insert: {
          agency_id: string
          archived_at?: string | null
          archived_by?: string | null
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
        }
        Update: {
          agency_id?: string
          archived_at?: string | null
          archived_by?: string | null
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
            foreignKeyName: "client_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
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
          id: string
          is_active: boolean
          is_demo: boolean
          language: string
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
          id?: string
          is_active?: boolean
          is_demo?: boolean
          language?: string
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
          id?: string
          is_active?: boolean
          is_demo?: boolean
          language?: string
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
            foreignKeyName: "knowledge_documents_virtual_office_id_fkey"
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
          overtime_threshold: number | null
          phone: string | null
          subscription_tier: string | null
          updated_at: string | null
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
          overtime_threshold?: number | null
          phone?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
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
          overtime_threshold?: number | null
          phone?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agency"
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
          branding: Json
          city: string | null
          code: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
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
          branding?: Json
          city?: string | null
          code?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
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
          branding?: Json
          city?: string | null
          code?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
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
      caregiver_agency_id: { Args: { _caregiver_id: string }; Returns: string }
      caregiver_pick_up_shift: { Args: { _shift_id: string }; Returns: Json }
      check_assignment_eligibility: {
        Args: { _caregiver_id: string; _shift_id: string }
        Returns: Json
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
      create_flow_draft: { Args: { p_flow_id: string }; Returns: string }
      current_agency_id: { Args: never; Returns: string }
      derived_shift_caregiver: { Args: { _shift_id: string }; Returns: string }
      discard_flow_draft: { Args: { p_draft_id: string }; Returns: undefined }
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
      is_published_public_agency: {
        Args: { _agency_id: string }
        Returns: boolean
      }
      knowledge_document_agency_id: {
        Args: { _document_id: string }
        Returns: string
      }
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
      my_agency_id: { Args: never; Returns: string }
      my_caregiver_ids: { Args: never; Returns: string[] }
      my_client_ids: { Args: never; Returns: string[] }
      order_agency_id: { Args: { _order_id: string }; Returns: string }
      order_client_id: { Args: { _order_id: string }; Returns: string }
      publish_flow_draft: { Args: { p_draft_id: string }; Returns: string }
      purge_demo_data: { Args: never; Returns: Json }
      purge_demo_data_dry_run: { Args: never; Returns: Json }
      release_shift_assignments: {
        Args: { _reason?: string; _shift_ids: string[] }
        Returns: number
      }
      search_agency_knowledge: {
        Args: {
          _agency_id?: string
          _language: string
          _limit?: number
          _query: string
        }
        Returns: {
          chunk_id: string
          content: string
          document_id: string
          document_title: string
          rank: number
        }[]
      }
      shift_assignment_agency_id: {
        Args: { _shift_id: string }
        Returns: string
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
      conversation_session_status:
        | "in_progress"
        | "completed"
        | "abandoned"
        | "submitted"
      earnings_line_status: "calculated" | "voided"
      earnings_rate_source: "shift" | "caregiver"
      flow_audience: "caregiver_screening" | "family_intake" | "general"
      flow_node_type:
        | "single_select"
        | "multi_select"
        | "info"
        | "contact_capture"
        | "terminal"
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
      conversation_session_status: [
        "in_progress",
        "completed",
        "abandoned",
        "submitted",
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
    },
  },
} as const
