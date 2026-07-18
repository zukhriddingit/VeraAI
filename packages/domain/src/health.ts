import { z } from "zod";

export const ServiceNameSchema = z.enum(["vera-web", "vera-worker"]);

export const HealthReportSchema = z
  .object({
    service: ServiceNameSchema,
    status: z.literal("ok"),
    version: z.string().min(1),
    checkedAt: z.string().datetime({ offset: true }),
    runtime: z
      .object({
        node: z.string().min(1)
      })
      .strict()
  })
  .strict();

export type ServiceName = z.infer<typeof ServiceNameSchema>;
export type HealthReport = z.infer<typeof HealthReportSchema>;

export interface HealthReportInput {
  service: ServiceName;
  version: string;
  now: Date;
  nodeVersion: string;
}

export function createHealthReport(input: HealthReportInput): HealthReport {
  return HealthReportSchema.parse({
    service: input.service,
    status: "ok",
    version: input.version,
    checkedAt: input.now.toISOString(),
    runtime: {
      node: input.nodeVersion
    }
  });
}
