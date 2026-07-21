import { z } from "zod";

import { ServiceNameSchema } from "./health.ts";
import { IsoDateTimeSchema } from "./primitives.ts";

export const DatabaseReadinessStatusSchema = z.enum([
  "ready",
  "unavailable",
  "timed_out",
  "migration_behind"
]);
export const DatabaseMigrationStatusSchema = z.enum(["current", "behind", "unknown"]);

export const ReadinessReportSchema = z
  .object({
    service: ServiceNameSchema,
    status: z.enum(["ready", "not_ready"]),
    checkedAt: IsoDateTimeSchema,
    database: z
      .object({
        status: DatabaseReadinessStatusSchema,
        migration: DatabaseMigrationStatusSchema
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    const databaseReady = value.database.status === "ready";
    const migrationCurrent = value.database.migration === "current";
    const reportReady = value.status === "ready";

    if (reportReady !== (databaseReady && migrationCurrent)) {
      context.addIssue({
        code: "custom",
        message: "Readiness must match database availability and migration state.",
        path: ["status"]
      });
    }
  });

export type DatabaseReadinessStatus = z.infer<typeof DatabaseReadinessStatusSchema>;
export type DatabaseMigrationStatus = z.infer<typeof DatabaseMigrationStatusSchema>;
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;
