import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface OverrideValues {
  max_weekly_hours: number | null;
  travel_buffer_minutes: number | null;
  late_trade_hours: number | null;
  smart_match_weights: any;
}

export interface AgencyDefaults {
  max_weekly_hours: number | null;
  travel_buffer_minutes: number | null;
  late_trade_hours: number | null;
  smart_match_weights: any;
}

interface Props {
  value: OverrideValues;
  defaults: AgencyDefaults;
  onChange: (next: OverrideValues) => void;
}

const NUM_FIELDS: { key: keyof OverrideValues; label: string }[] = [
  { key: "max_weekly_hours", label: "Max Weekly Hours" },
  { key: "travel_buffer_minutes", label: "Travel Buffer (minutes)" },
  { key: "late_trade_hours", label: "Late Trade Window (hours)" },
];

export const SchedulingOverridesCard = ({
  value,
  defaults,
  onChange,
}: Props) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduling Overrides</CardTitle>
        <CardDescription>
          Override agency defaults for this office. Blank = inherit the agency value.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Stored now; scheduling will use these in a later phase.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {NUM_FIELDS.map(({ key, label }) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={key}>{label}</Label>
              <Input
                id={key}
                type="number"
                min={0}
                value={(value[key] as number | null) ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [key]: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="Inherit"
              />
              <p className="text-xs text-muted-foreground">
                Override agency default (blank = inherit) — agency: {String(defaults[key] ?? "—")}
              </p>
            </div>
          ))}
        </div>

      </CardContent>
    </Card>
  );
};
