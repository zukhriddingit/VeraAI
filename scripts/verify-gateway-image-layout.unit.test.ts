import { describe, expect, it } from "vitest";

// The image-layout verifier is plain ESM so GitHub Actions can run it without installing packages.
// @ts-expect-error The runtime module intentionally has no generated declaration file.
import {
  findBootstrapSimulationViolations,
  findGatewayImageLayoutViolations
} from "./verify-gateway-image-layout.mjs";

function validLayout() {
  return {
    uid: 1000,
    gid: 1000,
    cwd: "/app",
    configuredWorkingDirectory: "/app",
    path: "/usr/bin",
    localBin: {
      isDirectory: true,
      isSymbolicLink: false,
      uid: 0,
      gid: 0,
      mode: 0o755,
      entries: []
    },
    usrBinEntries: ["node"],
    bannedPathsPresent: [],
    entrypoint: ["/usr/bin/node", "/opt/vera/bin/remote-extension-supervisor.mjs"]
  };
}

function validBootstrap() {
  return {
    created: true,
    filename: "maritime-bootstrap-layout-probe",
    uid: 0,
    gid: 0,
    mode: 0o500,
    removed: true,
    directoryEmpty: true
  };
}

describe("Gateway image-layout verifier", () => {
  it("accepts the exact provider-compatible runtime layout", () => {
    expect(findGatewayImageLayoutViolations(validLayout())).toEqual([]);
    expect(findBootstrapSimulationViolations(validBootstrap())).toEqual([]);
  });

  it.each([
    [
      "missing directory",
      (input: ReturnType<typeof validLayout>) => {
        input.localBin.isDirectory = false;
      }
    ],
    [
      "symbolic-link directory",
      (input: ReturnType<typeof validLayout>) => {
        input.localBin.isSymbolicLink = true;
      }
    ],
    [
      "non-root directory owner",
      (input: ReturnType<typeof validLayout>) => {
        input.localBin.uid = 1000;
      }
    ],
    [
      "non-root directory group",
      (input: ReturnType<typeof validLayout>) => {
        input.localBin.gid = 1000;
      }
    ],
    [
      "writable directory mode",
      (input: ReturnType<typeof validLayout>) => {
        input.localBin.mode = 0o777;
      }
    ],
    [
      "nonempty immutable directory",
      (input: ReturnType<typeof validLayout>) => {
        input.localBin.entries.push("busybox");
      }
    ],
    [
      "wrong runtime uid",
      (input: ReturnType<typeof validLayout>) => {
        input.uid = 0;
      }
    ],
    [
      "wrong runtime gid",
      (input: ReturnType<typeof validLayout>) => {
        input.gid = 0;
      }
    ],
    [
      "expanded application path",
      (input: ReturnType<typeof validLayout>) => {
        input.path = "/usr/local/bin:/usr/bin";
      }
    ],
    [
      "wrong working directory",
      (input: ReturnType<typeof validLayout>) => {
        input.cwd = "/usr/local/bin";
      }
    ],
    [
      "wrong configured working directory",
      (input: ReturnType<typeof validLayout>) => {
        input.configuredWorkingDirectory = "/usr/local/bin";
      }
    ],
    [
      "extra system executable",
      (input: ReturnType<typeof validLayout>) => {
        input.usrBinEntries.push("sh");
      }
    ],
    [
      "banned runtime path",
      (input: ReturnType<typeof validLayout>) => {
        input.bannedPathsPresent.push("/bin/sh");
      }
    ],
    [
      "wrong entrypoint",
      (input: ReturnType<typeof validLayout>) => {
        input.entrypoint = ["/bin/sh"];
      }
    ]
  ])("rejects %s", (_label, mutate) => {
    const input = validLayout();
    mutate(input);
    expect(findGatewayImageLayoutViolations(input)).not.toEqual([]);
  });

  it.each([
    [
      "helper was not created",
      (input: ReturnType<typeof validBootstrap>) => {
        input.created = false;
      }
    ],
    [
      "unexpected helper name",
      (input: ReturnType<typeof validBootstrap>) => {
        input.filename = "busybox";
      }
    ],
    [
      "helper not root owned",
      (input: ReturnType<typeof validBootstrap>) => {
        input.uid = 1000;
      }
    ],
    [
      "helper executable by every user",
      (input: ReturnType<typeof validBootstrap>) => {
        input.mode = 0o555;
      }
    ],
    [
      "helper retained",
      (input: ReturnType<typeof validBootstrap>) => {
        input.removed = false;
      }
    ],
    [
      "directory not restored empty",
      (input: ReturnType<typeof validBootstrap>) => {
        input.directoryEmpty = false;
      }
    ]
  ])("rejects simulated bootstrap when %s", (_label, mutate) => {
    const input = validBootstrap();
    mutate(input);
    expect(findBootstrapSimulationViolations(input)).not.toEqual([]);
  });
});
