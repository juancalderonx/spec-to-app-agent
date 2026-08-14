import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import type { SelectChangeEvent } from "@mui/material/Select";

import { SORT_KEYS, isSortKey, sortKeyLabel, type SortKey } from "@/utils/inventory";

export interface SortSelectProps {
  /** The sort key currently applied to the inventory. */
  value: SortKey;
  /** Called with the newly chosen sort key. */
  onChange: (key: SortKey) => void;
  /** Visible label; also the control's accessible name. */
  label?: string;
  /** Set while the inventory is unavailable. */
  disabled?: boolean;
}

const LABEL_ID = "sort-select-label";
const INPUT_ID = "sort-select";

export function SortSelect({
  value,
  onChange,
  label = "Sort by",
  disabled = false,
}: SortSelectProps) {
  const handleChange = (event: SelectChangeEvent) => {
    const next = event.target.value;
    if (isSortKey(next)) {
      onChange(next);
    }
  };

  return (
    <FormControl fullWidth size="small" disabled={disabled}>
      <InputLabel id={LABEL_ID}>{label}</InputLabel>
      <Select
        labelId={LABEL_ID}
        id={INPUT_ID}
        label={label}
        value={value}
        onChange={handleChange}
      >
        {SORT_KEYS.map((key) => (
          <MenuItem key={key} value={key}>
            {sortKeyLabel(key)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
