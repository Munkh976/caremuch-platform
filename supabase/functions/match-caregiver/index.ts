import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Weighted scoring formula for caregiver-shift matching. Weights must sum to 100.
// Tune here — each factor is scored 0-1 before weighting.
const WEIGHTS = {
  skillCoverage: 40, // share of the shift's + client's declared care_types.code the caregiver has a skill for
  serviceArea: 25,   // caregiver's service_zipcodes includes the client's zip (neutral if caregiver declares none)
  availability: 15,  // caregiver's declared weekly availability covers this shift's day/time (neutral if none declared)
  reliability: 10,   // caregivers.reliability_score / 100
  performance: 10,   // avg_rating/completion_rate/on_time_rate from caregiver_performance (neutral if not yet rated)
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

    // Structured, coded fields only. Deliberately NOT selecting medical_conditions,
    // care_requirements, client_care_needs.notes, or any client identity/contact
    // field — this function must never see or send client PHI.
    const { data: shift, error: shiftError } = await supabaseClient
      .from('shifts')
      .select(`
        *,
        clients (
          zip_code,
          preferred_caregiver_id,
          client_care_needs ( care_type_code )
        )
      `)
      .eq('id', shiftId)
      .single();

    if (shiftError) throw shiftError;

    // The shift's own care type is always required; declared client care needs add to it.
    // If the client has none on file, this reduces to just the shift's care type — never
    // empty, so scoring always has a real signal to work with.
    const neededCodes = Array.from(new Set([
      shift.care_type_code,
      ...(shift.clients?.client_care_needs ?? []).map((cn: any) => cn.care_type_code),
    ].filter(Boolean)));

    const { data: careTypeRows } = await supabaseClient
      .from('care_types')
      .select('code, name')
      .in('code', neededCodes);
    const careTypeNameByCode = new Map((careTypeRows || []).map((t: any) => [t.code, t.name]));

    const { data: caregivers, error: caregiversError } = await supabaseClient
      .from('caregivers')
      .select(`
        id, first_name, last_name, email, phone, city, hourly_rate, service_zipcodes, reliability_score,
        caregiver_skills ( care_type_code ),
        caregiver_availability ( day_of_week, start_time, end_time, is_available )
      `)
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

    const clientZip = shift.clients?.zip_code ?? null;
    // Date-only strings must be read as UTC to avoid a timezone-shifted day-of-week.
    const shiftDow = new Date(`${shift.shift_date}T00:00:00Z`).getUTCDay();

    const matches = (caregivers || []).map((c: any) => {
      const keyFactors: string[] = [];
      const warnings: string[] = [];

      // --- Skill coverage ---
      const skillCodes = new Set((c.caregiver_skills || []).map((s: any) => s.care_type_code));
      const matchedCodes = neededCodes.filter((code) => skillCodes.has(code));
      const skillCoverageScore = matchedCodes.length / neededCodes.length;
      if (matchedCodes.length > 0) {
        const names = matchedCodes.map((code) => careTypeNameByCode.get(code) || code);
        keyFactors.push(`Matches ${matchedCodes.length} of ${neededCodes.length} required care skills (${names.join(', ')})`);
      } else {
        warnings.push(`No matching skills on file for this shift's care requirements`);
      }

      // --- Service area (neutral if caregiver has no declared zip list) ---
      const zips: string[] = c.service_zipcodes || [];
      const serviceAreaScore = zips.length === 0 || !clientZip || zips.includes(clientZip) ? 1 : 0;
      if (serviceAreaScore === 0) {
        warnings.push(`Outside service area (client zip ${clientZip} not in caregiver's service zip list)`);
      }

      // --- Availability (neutral if caregiver has no declared weekly availability) ---
      const availRows: any[] = c.caregiver_availability || [];
      let availabilityScore = 1;
      if (availRows.length > 0) {
        const covered = availRows.some((a) =>
          a.day_of_week === shiftDow && a.is_available !== false &&
          a.start_time <= shift.start_time && a.end_time >= shift.end_time
        );
        availabilityScore = covered ? 1 : 0;
        if (!covered) warnings.push(`Outside declared availability for this shift's day/time`);
      }

      // --- Reliability ---
      const reliability = c.reliability_score ?? 100;
      const reliabilityScore = Math.min(Math.max(reliability, 0), 100) / 100;
      if (reliability < 70) {
        warnings.push(`Reliability score ${reliability} is below the 70 threshold`);
      }

      // --- Performance (neutral if not yet rated — never penalize a new caregiver) ---
      const perf = perfById.get(c.id);
      let performanceScore = 1;
      if (perf?.avg_rating != null) {
        performanceScore = (
          (perf.avg_rating / 5) +
          ((perf.completion_rate ?? 100) / 100) +
          ((perf.on_time_rate ?? 100) / 100)
        ) / 3;
        keyFactors.push(
          `Rated ${perf.avg_rating}/5.0 from ${perf.rating_count} shifts (completion ${perf.completion_rate}%, on-time ${perf.on_time_rate}%)`
        );
      } else {
        keyFactors.push('New caregiver — not yet rated (scored neutrally)');
      }

      const match_score = Math.round(
        WEIGHTS.skillCoverage * skillCoverageScore +
        WEIGHTS.serviceArea * serviceAreaScore +
        WEIGHTS.availability * availabilityScore +
        WEIGHTS.reliability * reliabilityScore +
        WEIGHTS.performance * performanceScore
      );

      if (shift.clients?.preferred_caregiver_id === c.id) {
        keyFactors.unshift('Preferred caregiver for this client');
      }

      return {
        caregiver_id: c.id,
        match_score,
        key_factors: keyFactors,
        warnings,
        caregiver: {
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone: c.phone,
          city: c.city,
          avg_rating: perf?.avg_rating ?? null,
          rating_count: perf?.rating_count ?? 0,
          completion_rate: perf?.completion_rate ?? null,
          on_time_rate: perf?.on_time_rate ?? null,
          hourly_rate: c.hourly_rate,
        },
      };
    }).sort((a, b) => b.match_score - a.match_score);

    return new Response(
      JSON.stringify({ matches }),
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
