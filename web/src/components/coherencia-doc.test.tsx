// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, test, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ModeloDocumentoCard } from "./ModeloDocumentoCard";

afterEach(cleanup);

test("la tarjeta puente refleja los valores exactos del PDF", () => {
  render(<ModeloDocumentoCard rumboReal={5.8263} destinoReal={[0.454, 4.449, 0]} />);
  expect(screen.getByText(/N 26.57° E/)).toBeInTheDocument();
  expect(screen.getByText(/2x − y = 0/)).toBeInTheDocument();
  expect(screen.getByText(/1 \+ 2√5 \+ 1 ≈ 6.47 u/)).toBeInTheDocument();
  expect(screen.getByText(/5.83/)).toBeInTheDocument(); // puente al rumbo real
  expect(screen.getByText(/890.3/)).toBeInTheDocument(); // escala
});
