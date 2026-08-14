import { useCallback, useMemo, useState } from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { AddCarForm } from "@/components/AddCarForm";
import type { AddCarFormValues } from "@/components/AddCarForm";
import { CarGrid } from "@/components/CarGrid";
import { ModelFilter } from "@/components/ModelFilter";
import { SortSelect } from "@/components/SortSelect";
import { useCars } from "@/hooks/useCars";
import { filterByModel, sortCars } from "@/utils/inventory";
import type { SortKey } from "@/utils/inventory";

export interface InventoryPageProps {
  /** Heading shown above the controls. */
  title?: string;
  /** Shown when the inventory loaded but nothing matches the current filter. */
  emptyMessage?: string;
}

function describeFailure(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.length > 0) {
    return reason.message;
  }
  return fallback;
}

export function InventoryPage({
  title = "Car inventory",
  emptyMessage = "No vehicles match that model.",
}: InventoryPageProps) {
  const { cars, loading, error, addCar } = useCars();

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("none");
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const visibleCars = useMemo(
    () => sortCars(filterByModel(cars, query), sortKey),
    [cars, query, sortKey],
  );

  const submit = useCallback(
    async (values: AddCarFormValues): Promise<void> => {
      setSubmitting(true);
      setAddError(null);
      try {
        const added = await addCar({
          make: values.make,
          model: values.model,
          year: values.year,
          color: values.color,
        });
        if (added === undefined) {
          setAddError("Could not add the vehicle. Please try again.");
        }
      } catch (reason: unknown) {
        setAddError(
          describeFailure(reason, "Could not add the vehicle. Please try again."),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [addCar],
  );

  const handleAdd = useCallback(
    (values: AddCarFormValues): void => {
      void submit(values);
    },
    [submit],
  );

  const inventoryUnavailable = loading || error !== undefined;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 } }}>
      <Typography variant="h4" component="h1" gutterBottom>
        {title}
      </Typography>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ mb: 3 }}
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <ModelFilter value={query} onChange={setQuery} />
        </Box>
        <SortSelect
          value={sortKey}
          onChange={setSortKey}
          disabled={inventoryUnavailable}
        />
      </Stack>

      <AddCarForm
        onAdd={handleAdd}
        submitting={submitting}
        errorMessage={addError}
      />

      <Divider sx={{ my: 3 }} />

      {loading ? (
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          justifyContent="center"
          sx={{ py: 6 }}
        >
          <CircularProgress aria-label="Loading inventory" />
          <Typography variant="body1">Loading inventory…</Typography>
        </Stack>
      ) : error !== undefined ? (
        <Alert severity="error">
          Could not load the inventory. Please try again.
          {error.message.length > 0 ? ` (${error.message})` : ""}
        </Alert>
      ) : (
        <CarGrid cars={visibleCars} emptyMessage={emptyMessage} />
      )}
    </Container>
  );
}
