// Generated from the Supabase schema (project asndlkpodgwmtmulgthy) via the Supabase MCP on 2026-11-21.
// Do not edit by hand: regenerate after every migration.
// Money columns ending in _paise are integer paise (100 paise = Rs 1).

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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      assistant_drafts: {
        Row: {
          action_json: Json
          confirmed_at: string | null
          created_at: string
          expires_at: string
          id: string
          intent: string
          result_entry_id: string | null
          shop_id: string
          status: string
          transcript: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action_json: Json
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          intent: string
          result_entry_id?: string | null
          shop_id: string
          status?: string
          transcript?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action_json?: Json
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          intent?: string
          result_entry_id?: string | null
          shop_id?: string
          status?: string
          transcript?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_drafts_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_drafts_shop_id_result_entry_id_fkey"
            columns: ["shop_id", "result_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["shop_id", "id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          row_id: string | null
          shop_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          row_id?: string | null
          shop_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          row_id?: string | null
          shop_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          aliases: string[]
          archived_at: string | null
          created_at: string
          credit_score: number | null
          id: string
          legacy_ref: string | null
          locality: string | null
          name: string
          phone: string | null
          search_text: string | null
          shop_id: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          aliases?: string[]
          archived_at?: string | null
          created_at?: string
          credit_score?: number | null
          id?: string
          legacy_ref?: string | null
          locality?: string | null
          name: string
          phone?: string | null
          search_text?: string | null
          shop_id: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          aliases?: string[]
          archived_at?: string | null
          created_at?: string
          credit_score?: number | null
          id?: string
          legacy_ref?: string | null
          locality?: string | null
          name?: string
          phone?: string | null
          search_text?: string | null
          shop_id?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount_paise: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          due_delta_paise: number
          id: string
          legacy_ref: string | null
          note: string | null
          paid_paise: number
          payment_mode: string | null
          ref_entry_id: string | null
          shop_id: string
          source: string
          transcript: string | null
          type: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          due_delta_paise?: number
          id?: string
          legacy_ref?: string | null
          note?: string | null
          paid_paise?: number
          payment_mode?: string | null
          ref_entry_id?: string | null
          shop_id: string
          source?: string
          transcript?: string | null
          type: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          due_delta_paise?: number
          id?: string
          legacy_ref?: string | null
          note?: string | null
          paid_paise?: number
          payment_mode?: string | null
          ref_entry_id?: string | null
          shop_id?: string
          source?: string
          transcript?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_shop_id_customer_id_fkey"
            columns: ["shop_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customer_balances"
            referencedColumns: ["shop_id", "customer_id"]
          },
          {
            foreignKeyName: "ledger_entries_shop_id_customer_id_fkey"
            columns: ["shop_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["shop_id", "id"]
          },
          {
            foreignKeyName: "ledger_entries_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_shop_id_ref_entry_id_fkey"
            columns: ["shop_id", "ref_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["shop_id", "id"]
          },
        ]
      }
      ledger_items: {
        Row: {
          created_at: string
          entry_id: string
          id: string
          line_total_paise: number
          product_id: string | null
          product_name_snapshot: string
          qty: number
          shop_id: string
          unit: string
          unit_price_paise: number
        }
        Insert: {
          created_at?: string
          entry_id: string
          id?: string
          line_total_paise: number
          product_id?: string | null
          product_name_snapshot: string
          qty: number
          shop_id: string
          unit: string
          unit_price_paise: number
        }
        Update: {
          created_at?: string
          entry_id?: string
          id?: string
          line_total_paise?: number
          product_id?: string | null
          product_name_snapshot?: string
          qty?: number
          shop_id?: string
          unit?: string
          unit_price_paise?: number
        }
        Relationships: [
          {
            foreignKeyName: "ledger_items_shop_id_entry_id_fkey"
            columns: ["shop_id", "entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["shop_id", "id"]
          },
          {
            foreignKeyName: "ledger_items_shop_id_product_id_fkey"
            columns: ["shop_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["shop_id", "id"]
          },
        ]
      }
      notebook_import_rows: {
        Row: {
          amount_paise: number | null
          checked: boolean
          committed_entry_id: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          id: string
          import_id: string
          raw_text: string | null
          row_index: number
          shop_id: string
          updated_at: string
        }
        Insert: {
          amount_paise?: number | null
          checked?: boolean
          committed_entry_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          import_id: string
          raw_text?: string | null
          row_index: number
          shop_id: string
          updated_at?: string
        }
        Update: {
          amount_paise?: number | null
          checked?: boolean
          committed_entry_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          import_id?: string
          raw_text?: string | null
          row_index?: number
          shop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notebook_import_rows_shop_id_committed_entry_id_fkey"
            columns: ["shop_id", "committed_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["shop_id", "id"]
          },
          {
            foreignKeyName: "notebook_import_rows_shop_id_customer_id_fkey"
            columns: ["shop_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customer_balances"
            referencedColumns: ["shop_id", "customer_id"]
          },
          {
            foreignKeyName: "notebook_import_rows_shop_id_customer_id_fkey"
            columns: ["shop_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["shop_id", "id"]
          },
          {
            foreignKeyName: "notebook_import_rows_shop_id_import_id_fkey"
            columns: ["shop_id", "import_id"]
            isOneToOne: false
            referencedRelation: "notebook_imports"
            referencedColumns: ["shop_id", "id"]
          },
        ]
      }
      notebook_imports: {
        Row: {
          committed_at: string | null
          created_at: string
          id: string
          ocr_provider: string
          shop_id: string
          status: string
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          id?: string
          ocr_provider: string
          shop_id: string
          status?: string
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          id?: string
          ocr_provider?: string
          shop_id?: string
          status?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notebook_imports_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          aliases: string[]
          archived_at: string | null
          category: string | null
          created_at: string
          expiry_date: string | null
          id: string
          legacy_ref: string | null
          low_stock_threshold: number
          name: string
          purchase_price_paise: number | null
          search_text: string | null
          selling_price_paise: number | null
          shop_id: string
          stock_qty: number
          unit: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          archived_at?: string | null
          category?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          legacy_ref?: string | null
          low_stock_threshold?: number
          name: string
          purchase_price_paise?: number | null
          search_text?: string | null
          selling_price_paise?: number | null
          shop_id: string
          stock_qty?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          archived_at?: string | null
          category?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          legacy_ref?: string | null
          low_stock_threshold?: number
          name?: string
          purchase_price_paise?: number | null
          search_text?: string | null
          selling_price_paise?: number | null
          shop_id?: string
          stock_qty?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          consent_at: string | null
          created_at: string
          email: string
          owner_name: string
          phone: string
          primary_language: string | null
          secondary_language: string | null
          shop_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          consent_at?: string | null
          created_at?: string
          email: string
          owner_name: string
          phone: string
          primary_language?: string | null
          secondary_language?: string | null
          shop_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          consent_at?: string | null
          created_at?: string
          email?: string
          owner_name?: string
          phone?: string
          primary_language?: string | null
          secondary_language?: string | null
          shop_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          balance_paise: number | null
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          language: string
          message_text: string
          shop_id: string
          status: string
          tone: string
          updated_at: string
        }
        Insert: {
          balance_paise?: number | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          language: string
          message_text: string
          shop_id: string
          status?: string
          tone: string
          updated_at?: string
        }
        Update: {
          balance_paise?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          language?: string
          message_text?: string
          shop_id?: string
          status?: string
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_shop_id_customer_id_fkey"
            columns: ["shop_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customer_balances"
            referencedColumns: ["shop_id", "customer_id"]
          },
          {
            foreignKeyName: "reminders_shop_id_customer_id_fkey"
            columns: ["shop_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["shop_id", "id"]
          },
        ]
      }
      shops: {
        Row: {
          address: string | null
          business_domain: string | null
          city: string | null
          created_at: string
          fssai_number: string | null
          gst_number: string | null
          id: string
          owner_user_id: string
          shop_name: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_domain?: string | null
          city?: string | null
          created_at?: string
          fssai_number?: string | null
          gst_number?: string | null
          id?: string
          owner_user_id: string
          shop_name?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_domain?: string | null
          city?: string | null
          created_at?: string
          fssai_number?: string | null
          gst_number?: string | null
          id?: string
          owner_user_id?: string
          shop_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          entry_id: string | null
          id: string
          note: string | null
          product_id: string
          qty_change: number
          reason: string
          shop_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entry_id?: string | null
          id?: string
          note?: string | null
          product_id: string
          qty_change: number
          reason: string
          shop_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entry_id?: string | null
          id?: string
          note?: string | null
          product_id?: string
          qty_change?: number
          reason?: string
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_shop_id_entry_id_fkey"
            columns: ["shop_id", "entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["shop_id", "id"]
          },
          {
            foreignKeyName: "stock_movements_shop_id_product_id_fkey"
            columns: ["shop_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["shop_id", "id"]
          },
        ]
      }
      support_report_attachments: {
        Row: {
          created_at: string
          id: string
          media_type: string
          name: string
          report_id: string
          shop_id: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_type: string
          name: string
          report_id: string
          shop_id: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          media_type?: string
          name?: string
          report_id?: string
          shop_id?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_report_attachments_shop_id_report_id_fkey"
            columns: ["shop_id", "report_id"]
            isOneToOne: false
            referencedRelation: "support_reports"
            referencedColumns: ["shop_id", "id"]
          },
        ]
      }
      support_reports: {
        Row: {
          categories: string[]
          contact_allowed: boolean
          created_at: string
          description: string
          id: string
          reference: string
          shop_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          categories: string[]
          contact_allowed?: boolean
          created_at?: string
          description: string
          id?: string
          reference?: string
          shop_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          categories?: string[]
          contact_allowed?: boolean
          created_at?: string
          description?: string
          id?: string
          reference?: string
          shop_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_reports_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          created_at: string
          daily_ledger_pdf: boolean
          low_stock_alert: boolean
          payment_reminder: boolean
          spoken_replies: boolean
          updated_at: string
          user_id: string
          voice_speed: string
          voice_volume: number
        }
        Insert: {
          created_at?: string
          daily_ledger_pdf?: boolean
          low_stock_alert?: boolean
          payment_reminder?: boolean
          spoken_replies?: boolean
          updated_at?: string
          user_id: string
          voice_speed?: string
          voice_volume?: number
        }
        Update: {
          created_at?: string
          daily_ledger_pdf?: boolean
          low_stock_alert?: boolean
          payment_reminder?: boolean
          spoken_replies?: boolean
          updated_at?: string
          user_id?: string
          voice_speed?: string
          voice_volume?: number
        }
        Relationships: []
      }
      voice_usage: {
        Row: {
          audio_seconds: number
          characters: number
          created_at: string
          endpoint: string
          id: string
          provider: string
          shop_id: string
          success: boolean
          user_id: string
        }
        Insert: {
          audio_seconds?: number
          characters?: number
          created_at?: string
          endpoint: string
          id?: string
          provider: string
          shop_id: string
          success?: boolean
          user_id: string
        }
        Update: {
          audio_seconds?: number
          characters?: number
          created_at?: string
          endpoint?: string
          id?: string
          provider?: string
          shop_id?: string
          success?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_usage_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      customer_balances: {
        Row: {
          archived_at: string | null
          balance_paise: number | null
          customer_id: string | null
          entry_count: number | null
          last_entry_at: string | null
          locality: string | null
          name: string | null
          phone: string | null
          shop_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      customers_with_old_dues: {
        Args: { p_min_days?: number; p_shop_id: string }
        Returns: {
          balance_paise: number
          customer_id: string
          days_overdue: number
          locality: string
          name: string
          oldest_unpaid_at: string
          phone: string
          whatsapp: string
        }[]
      }
      explain_customer_balance: {
        Args: { p_customer_id: string; p_shop_id: string }
        Returns: {
          amount_paise: number
          created_at: string
          due_delta_paise: number
          entry_id: string
          items_summary: string
          note: string
          paid_paise: number
          payment_mode: string
          ref_entry_id: string
          running_balance_paise: number
          type: string
        }[]
      }
      search_customers: {
        Args: { p_limit?: number; p_query: string; p_shop_id: string }
        Returns: {
          customer_id: string
          locality: string
          name: string
          phone: string
          score: number
        }[]
      }
      search_products: {
        Args: { p_limit?: number; p_query: string; p_shop_id: string }
        Returns: {
          name: string
          product_id: string
          score: number
          selling_price_paise: number
          stock_qty: number
          unit: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
