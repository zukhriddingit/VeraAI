import { describe, expect, it } from "vitest";

import { findHerokuProductionViolations } from "./verify-heroku-production.ts";

const manifest = {
  version: "vera-heroku-production.v1",
  app: "vera-housing-app",
  productDomain: "app.verahousing.app",
  marketingDomain: "verahousing.app",
  processes: {
    web: { dockerfile: "Dockerfile.web", quantity: 1, readinessPath: "/api/ready" },
    worker: { dockerfile: "Dockerfile", quantity: 1, readinessPath: "/health" }
  },
  database: {
    provider: "heroku-postgresql",
    minimumPlan: "standard-0",
    attachment: "VERA_GREEN_DATABASE",
    sameRegion: true
  },
  release: {
    processTypes: ["web", "worker"],
    sourceRevisionLabel: "org.opencontainers.image.revision",
    automaticDeploy: false
  },
  openclaw: { deploymentAction: "none", gatewayImageChange: false }
} as const;

const webDockerfile = `USER vera
HEALTHCHECK CMD fetch('http://127.0.0.1:'+process.env.PORT+'/api/ready')
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
`;

const workerDockerfile = `USER vera
HEALTHCHECK CMD fetch('http://127.0.0.1:8080/health')
CMD ["node", "apps/worker/dist/index.js", "serve"]
`;

const workflow = `
app_images:
  name: Build Heroku application images
  steps:
    - name: Build Heroku web image
      with:
        file: Dockerfile.web
        push: false
        tags: vera-web:ci
        labels: org.opencontainers.image.revision=\${{ github.event.pull_request.head.sha || github.sha }}
    - name: Build Heroku worker image
      with:
        file: Dockerfile
        push: false
        tags: vera-worker:ci
        labels: org.opencontainers.image.revision=\${{ github.event.pull_request.head.sha || github.sha }}
`;

function input(
  overrides: Partial<Parameters<typeof findHerokuProductionViolations>[0]> = {}
): Parameters<typeof findHerokuProductionViolations>[0] {
  return { manifest, webDockerfile, workerDockerfile, workflow, ...overrides };
}

describe("Heroku production boundaries", () => {
  it("accepts the paired application topology", () => {
    expect(findHerokuProductionViolations(input())).toEqual([]);
  });

  it.each([
    ["wrong app", { ...manifest, app: "vera-staging" }],
    ["wrong product domain", { ...manifest, productDomain: "verahousing.app" }],
    [
      "two workers",
      {
        ...manifest,
        processes: {
          ...manifest.processes,
          worker: { ...manifest.processes.worker, quantity: 2 }
        }
      }
    ],
    [
      "development database",
      { ...manifest, database: { ...manifest.database, minimumPlan: "essential-0" } }
    ],
    ["automatic deploy", { ...manifest, release: { ...manifest.release, automaticDeploy: true } }],
    [
      "Gateway mutation",
      { ...manifest, openclaw: { deploymentAction: "restart", gatewayImageChange: false } }
    ]
  ])("rejects %s", (_name, changed) => {
    expect(findHerokuProductionViolations(input({ manifest: changed }))).not.toEqual([]);
  });

  it("rejects a workflow that builds only web", () => {
    expect(
      findHerokuProductionViolations(
        input({ workflow: workflow.replace("Build Heroku worker image", "Removed worker image") })
      )
    ).toContain("CI must build the Heroku web and worker images from one source revision.");
  });

  it("rejects publishing in the application image job", () => {
    expect(
      findHerokuProductionViolations(
        input({ workflow: workflow.replace("push: false", "push: true") })
      )
    ).toContain("Application-image CI must verify without publishing.");
  });

  it("rejects OpenClaw work in the application image job", () => {
    expect(
      findHerokuProductionViolations({
        ...input(),
        workflow: `${workflow}\n    - run: docker build infra/maritime/openclaw\n`
      })
    ).toContain("Heroku application-image CI must not build OpenClaw or the Gateway.");
  });
});
