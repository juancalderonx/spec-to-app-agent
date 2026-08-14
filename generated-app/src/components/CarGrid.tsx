import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { CarCard } from "@/components/CarCard";
import type { Car } from "@/types";

export interface CarGridProps {
  /** Vehicles to lay out. Supplied by the parent; this grid fetches nothing. */
  cars: Car[];
  /** Shown in place of the grid when there are no vehicles to display. */
  emptyMessage?: string;
}

export function CarGrid({
  cars,
  emptyMessage = "No vehicles in inventory.",
}: CarGridProps) {
  if (cars.length === 0) {
    return (
      <Typography variant="body1" color="text.secondary" role="status">
        {emptyMessage}
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        alignItems: "stretch",
        gridTemplateColumns: {
          xs: "1fr",
          sm: "repeat(2, minmax(0, 1fr))",
          md: "repeat(3, minmax(0, 1fr))",
          lg: "repeat(4, minmax(0, 1fr))",
        },
      }}
    >
      {cars.map((car) => (
        <CarCard key={car.id} car={car} />
      ))}
    </Box>
  );
}
