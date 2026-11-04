// ============================================================
// DEXMIN CONFIGURATION WRITE GUARD
// Development Only
// ============================================================

const DOMAIN = "classify.aldozeno.my.id";

export function canWriteConfiguration(
  request: Request,
): boolean {

  const host = (
    request.headers.get("host") ?? ""
  ).toLowerCase();

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.toLowerCase();

  const forwardedProto = request.headers.get(
    "x-forwarded-proto",
  );

  const origin = request.headers.get("origin");

  const fetchSite = request.headers.get(
    "sec-fetch-site",
  );

  // ==========================================================
  // ALLOWED HOSTS
  // ==========================================================

  let expectedOrigin: string;
  let expectedProtocol: string;

  if (
    host === "127.0.0.1:3030" ||
    host === "localhost:3030"
  ) {

    if (
      process.env
        .DEXMIN_ENABLE_LOCAL_PUMP_SETPOINT_WRITE !== "1"
    ) {
      return false;
    }

    expectedOrigin = `http://${host}`;
    expectedProtocol = "http";

  } else if (host === DOMAIN) {

    if (
      process.env.DEXMIN_ENABLE_DOMAIN_CRUD !== "1"
    ) {
      return false;
    }

    expectedOrigin = `https://${DOMAIN}`;
    expectedProtocol = "https";

  } else {
    return false;
  }

  // ==========================================================
  // REQUEST VALIDATION
  // ==========================================================

  if (
    forwardedHost &&
    forwardedHost !== host
  ) {
    return false;
  }

  if (
    forwardedProto &&
    forwardedProto !== expectedProtocol
  ) {
    return false;
  }

  if (
    origin &&
    origin !== expectedOrigin
  ) {
    return false;
  }

  if (
    fetchSite &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    return false;
  }

  return true;
}