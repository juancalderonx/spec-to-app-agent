import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { Breakpoint, useBreakpoint } from "@/hooks/useBreakpoint";
import { Car } from "@/types";

export interface CarCardProps {
  /** The vehicle to display. Supplied by the parent; this card fetches nothing. */
  car: Car;
}

/** Picks the image source belonging to the given viewport band. */
function imageForBreakpoint(car: Car, breakpoint: Breakpoint): string {
  switch (breakpoint) {
    case "mobile":
      return car.mobile;
    case "tablet":
      return car.tablet;
    case "desktop":
      return car.desktop;
  }
}

export function CarCard({ car }: CarCardProps) {
  const { breakpoint } = useBreakpoint();
  const imageSource = imageForBreakpoint(car, breakpoint);
  const title = `${car.make} ${car.model}`;

  return (
    <Card
      component="article"
      aria-label={`${car.year} ${title}`}
      sx={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <CardMedia
        component="img"
        src={imageSource}
        alt={`${car.year} ${title} in ${car.color}`}
        loading="lazy"
        sx={{ height: 180, objectFit: "cover", backgroundColor: "action.hover" }}
      />
      <CardContent sx={{ flexGrow: 1 }}>
        <Typography variant="h6" component="h3" gutterBottom>
          {title}
        </Typography>
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">
            {`Year: ${car.year}`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {`Colour: ${car.color}`}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
