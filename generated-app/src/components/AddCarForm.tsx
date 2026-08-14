import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";

/** The vehicle a staff member has just described, ready for the data layer. */
export interface AddCarFormValues {
  make: string;
  model: string;
  year: number;
  color: string;
}

export interface AddCarFormProps {
  /**
   * Called with the validated values. This component never issues a GraphQL
   * operation itself; the wiring layer decides what happens next.
   */
  onAdd: (values: AddCarFormValues) => void;
  /** Disables the submit control while the caller's mutation is in flight. */
  submitting?: boolean;
  /** A failure reported by the caller, shown above the fields. */
  errorMessage?: string | null;
}

type FieldName = "make" | "model" | "year" | "color";

const FIELD_NAMES: readonly FieldName[] = ["make", "model", "year", "color"];

const EMPTY_FIELDS: Record<FieldName, string> = {
  make: "",
  model: "",
  year: "",
  color: "",
};

const LABELS: Record<FieldName, string> = {
  make: "Make",
  model: "Model",
  year: "Year",
  color: "Color",
};

export function AddCarForm({
  onAdd,
  submitting = false,
  errorMessage = null,
}: AddCarFormProps) {
  const [fields, setFields] = useState<Record<FieldName, string>>({
    ...EMPTY_FIELDS,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<readonly FieldName[]>([]);

  const handleChange =
    (name: FieldName) => (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setFields((previous) => ({ ...previous, [name]: value }));
    };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = {
      make: fields.make.trim(),
      model: fields.model.trim(),
      year: fields.year.trim(),
      color: fields.color.trim(),
    };

    const empty = FIELD_NAMES.filter((name) => trimmed[name] === "");
    if (empty.length > 0) {
      setInvalid(empty);
      setMessage("Every field is required.");
      return;
    }

    const year = Number(trimmed.year);
    if (!Number.isInteger(year) || year <= 0) {
      setInvalid(["year"]);
      setMessage("Year must be a number.");
      return;
    }

    setInvalid([]);
    setMessage(null);
    onAdd({
      make: trimmed.make,
      model: trimmed.model,
      year,
      color: trimmed.color,
    });
    setFields({ ...EMPTY_FIELDS });
  };

  return (
    <Box
      component="form"
      aria-label="Add a vehicle"
      noValidate
      onSubmit={handleSubmit}
      sx={{ mb: 3 }}
    >
      <Stack spacing={2}>
        {errorMessage === null ? null : (
          <Alert severity="error">{errorMessage}</Alert>
        )}
        {message === null ? null : <Alert severity="warning">{message}</Alert>}
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          alignItems={{ xs: "stretch", md: "flex-start" }}
        >
          {FIELD_NAMES.map((name) => (
            <TextField
              key={name}
              id={`add-car-${name}`}
              name={name}
              label={LABELS[name]}
              value={fields[name]}
              onChange={handleChange(name)}
              error={invalid.includes(name)}
              inputMode={name === "year" ? "numeric" : "text"}
              size="small"
              fullWidth
            />
          ))}
          <Button
            type="submit"
            variant="contained"
            disabled={submitting}
            sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
          >
            Add Car
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
