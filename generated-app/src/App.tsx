import { ApolloProvider } from "@apollo/client";

import { client } from "@/graphql/client";
import { InventoryPage } from "@/components/InventoryPage";

/**
 * Application shell.
 *
 * Wiring only: it hands the single shared Apollo client to the tree and renders
 * the inventory page. All vehicle markup, queries, filtering and sorting live
 * below this file.
 *
 * `ThemeProvider` and `CssBaseline` are mounted once in `src/main.tsx`, above
 * this component, so they are deliberately not repeated here — a second theme
 * or baseline would only fight the first. The same client instance is used for
 * `ApolloProvider`, so the tree keeps one normalised cache.
 */
export default function App() {
  return (
    <ApolloProvider client={client}>
      <InventoryPage />
    </ApolloProvider>
  );
}
