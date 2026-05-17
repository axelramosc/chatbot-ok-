import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const phone = "5218441757500";
  
  console.log("1. Selecting conversation...");
  const { data: rows, error: selectError } = await supabase
    .from("conversations")
    .select("*")
    .eq("phone_number", phone)
    .not("status", "eq", "closed")
    .order("updated_at", { ascending: false })
    .limit(1);

  console.log("Select result:", { rows, selectError });

  if (!rows || rows.length === 0) {
    console.log("2. Inserting conversation...");
    const { data: insertData, error: insertError } = await supabase
      .from("conversations")
      .insert({
        phone_number: phone,
        status: "active",
      })
      .select()
      .single();

    console.log("Insert result:", { insertData, insertError });
  }
}

test().catch(console.error);
