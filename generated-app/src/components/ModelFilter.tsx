import TextField from "@mui/material/TextField";

export interface ModelFilterProps {
  /** Current filter text. The component is fully controlled by this value. */
  value: string;
  /** Called with the full text of the field on every keystroke. */
  onChange: (value: string) => void;
}

export function ModelFilter({ value, onChange }: ModelFilterProps) {
  return (
    <TextField
      label="Filter by model"
      placeholder="e.g. Corolla"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      fullWidth
      size="small"
      type="search"
      inputProps={{ "aria-label": "Filter by model" }}
    />
  );
}
