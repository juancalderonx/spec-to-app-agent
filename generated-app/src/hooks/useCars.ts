import { useCallback } from "react";
import { useMutation, useQuery, type ApolloError } from "@apollo/client";
import { ADD_CAR, GET_CARS } from "@/graphql/queries";
import type { Car } from "@/types";

/** Shape returned by the GetCars query. */
export interface GetCarsData {
  cars: Car[];
}

/** Shape returned by the AddCar mutation. */
export interface AddCarData {
  addCar: Car;
}

/** Variables accepted by the AddCar mutation. */
export interface AddCarInput {
  make: string;
  model: string;
  year: number;
  color: string;
}

/** Everything the presentation layer needs to read and extend the inventory. */
export interface UseCarsResult {
  /** The current inventory. Empty while loading or after a failure. */
  cars: Car[];
  loading: boolean;
  error: ApolloError | undefined;
  /** Adds a vehicle and resolves once the mutation has completed. */
  addCar: (input: AddCarInput) => Promise<Car | undefined>;
}

export function useCars(): UseCarsResult {
  const { data, loading, error } = useQuery<GetCarsData>(GET_CARS);

  const [runAddCar] = useMutation<AddCarData, AddCarInput>(ADD_CAR, {
    update(cache, result) {
      const created = result.data?.addCar;
      if (!created) {
        return;
      }
      const existing = cache.readQuery<GetCarsData>({ query: GET_CARS });
      cache.writeQuery<GetCarsData>({
        query: GET_CARS,
        data: { cars: [...(existing?.cars ?? []), created] },
      });
    },
  });

  const addCar = useCallback(
    async (input: AddCarInput): Promise<Car | undefined> => {
      const result = await runAddCar({ variables: input });
      return result.data?.addCar ?? undefined;
    },
    [runAddCar],
  );

  return {
    cars: data?.cars ?? [],
    loading,
    error,
    addCar,
  };
}
