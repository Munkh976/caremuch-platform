import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callLLM, LLMGatewayError } from '../_shared/callLLM.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { shiftId } = await req.json();
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch shift details
    const { data: shift, error: shiftError } = await supabaseClient
      .from('shifts')
      .select(`
        *,
        clients (
          first_name,
          last_name,
          medical_conditions,
          care_requirements,
          address,
          city,
          state,
          zip_code,
          preferred_caregiver_id
        )
      `)
      .eq('id', shiftId)
      .single();

    if (shiftError) throw shiftError;

    // Fetch available caregivers
    const { data: caregivers, error: caregiversError } = await supabaseClient
      .from('caregivers')
      .select('*')
      .eq('agency_id', shift.agency_id)
      .eq('is_active', true);

    if (caregiversError) throw caregiversError;

    // Ratings come ONLY from the computed source (shift_ratings via caregiver_performance).
    // caregivers.performance_rating is deprecated and must not influence ranking.
    const { data: perfRows } = await supabaseClient
      .from('caregiver_performance')
      .select('caregiver_id, avg_rating, rating_count, completion_rate, on_time_rate')
      .in('caregiver_id', (caregivers || []).map((c: any) => c.id));
    const perfById = new Map((perfRows || []).map((p: any) => [p.caregiver_id, p]));

    // Use Lovable AI to match caregivers
    const systemPrompt = `You are an expert caregiver matching system. Analyze the shift requirements and caregiver qualifications to calculate match scores.

Consider these factors:
1. Skills match (certifications, required skills)
2. Client care requirements vs caregiver capabilities
3. Location match - CRITICAL: Check if client zip code is in caregiver's service_zipcodes array
4. Computed performance (average rating from real completed-shift ratings, completion and on-time rates). Some caregivers have NO ratings yet: treat them as NEUTRAL on this factor — score them on the other factors only. Never treat "not yet rated" as a low or zero rating.
5. Preferred caregiver status
6. Availability and work hours

IMPORTANT: Caregivers should only be matched if the client's zip code is in their service_zipcodes list. If not in the list, give a low match score (below 40).

Return a JSON array of caregiver matches with scores from 0-100, reasoning, and key factors.`;

    const userPrompt = `
Shift Details:
- Date: ${shift.shift_date}
- Time: ${shift.start_time} to ${shift.end_time}
- Care Type: ${shift.care_type_code}
- Required Skills: ${shift.required_skills?.join(', ') || 'None specified'}
- Duration: ${shift.duration_hours} hours
- Client: ${shift.clients?.first_name} ${shift.clients?.last_name}
- Client Conditions: ${shift.clients?.medical_conditions?.join(', ') || 'None'}
- Client Requirements: ${shift.clients?.care_requirements?.join(', ') || 'None'}
- Client Location: ${shift.clients?.city || 'Unknown'}, ${shift.clients?.state || 'Unknown'}
- Client Zip Code: ${shift.clients?.zip_code || 'Not specified'}
- Preferred Caregiver: ${shift.clients?.preferred_caregiver_id || 'None'}

Available Caregivers:
${caregivers.map((c, i) => `
${i + 1}. ${c.first_name} ${c.last_name} (ID: ${c.id})
   - Role: ${c.role}
   - Skills: ${c.skills?.join(', ') || 'None'}
   - Certifications: ${c.certifications?.join(', ') || 'None'}
   - Rating: ${perfById.get(c.id)?.avg_rating != null ? `${perfById.get(c.id).avg_rating}/5.0 from ${perfById.get(c.id).rating_count} rated shifts` : 'Not yet rated (neutral — do not penalise)'}
   - Completion Rate: ${perfById.get(c.id)?.completion_rate ?? 'n/a'}%
   - On-time Rate: ${perfById.get(c.id)?.on_time_rate ?? 'n/a'}%
   - Service Zip Codes: ${c.service_zipcodes?.join(', ') || 'Not specified'}
   - Hourly Rate: $${c.hourly_rate || 'N/A'}
`).join('\n')}

Calculate match scores for each caregiver. Remember to heavily weight whether the client's zip code (${shift.clients?.zip_code}) is in the caregiver's service zip codes list.`;

    let matches: any[];
    try {
      const result = await callLLM<{ matches: any[] }>({
        systemPrompt,
        userPrompt,
        toolName: 'provide_matches',
        toolDescription: 'Provide caregiver match scores and reasoning',
        schema: {
          type: 'object',
          properties: {
            matches: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  caregiver_id: { type: 'string' },
                  match_score: { type: 'number', minimum: 0, maximum: 100 },
                  key_factors: { type: 'array', items: { type: 'string' } },
                  warnings: { type: 'array', items: { type: 'string' } },
                  distance_miles: { type: 'number' },
                },
                required: ['caregiver_id', 'match_score', 'key_factors'],
              },
            },
          },
          required: ['matches'],
        },
      });
      matches = result.matches;
    } catch (err) {
      if (err instanceof LLMGatewayError) {
        console.error('AI Gateway Error:', err.status, err.body);
        if (err.status === 429) {
          return new Response(
            JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (err.status === 402) {
          return new Response(
            JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
      throw err;
    }

    // Enrich matches with caregiver details
    const enrichedMatches = matches.map((match: any) => {
      const caregiver = caregivers.find(c => c.id === match.caregiver_id);
      return {
        ...match,
        caregiver: caregiver ? {
          id: caregiver.id,
          first_name: caregiver.first_name,
          last_name: caregiver.last_name,
          email: caregiver.email,
          phone: caregiver.phone,
          avg_rating: perfById.get(caregiver.id)?.avg_rating ?? null,
          rating_count: perfById.get(caregiver.id)?.rating_count ?? 0,
          completion_rate: perfById.get(caregiver.id)?.completion_rate ?? null,
          on_time_rate: perfById.get(caregiver.id)?.on_time_rate ?? null,
          hourly_rate: caregiver.hourly_rate,
          skills: caregiver.skills,
          certifications: caregiver.certifications,
          city: caregiver.city
        } : null
      };
    }).filter((m: any) => m.caregiver !== null)
      .sort((a: any, b: any) => b.match_score - a.match_score);

    return new Response(
      JSON.stringify({ matches: enrichedMatches }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in match-caregiver:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
