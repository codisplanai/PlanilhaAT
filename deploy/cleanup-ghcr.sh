#!/usr/bin/env bash
set -Eeuo pipefail

RAW_PACKAGE="${1:-${GITHUB_REPOSITORY:-}}"
PACKAGE="${RAW_PACKAGE#*/}"
PACKAGE="${PACKAGE,,}"
OWNER="${GHCR_OWNER:-${GITHUB_REPOSITORY_OWNER:-}}"

if [[ -z "$PACKAGE" ]]; then
  echo "Usage: $0 <container-package-name>" >&2
  exit 2
fi

if [[ -z "$OWNER" ]]; then
  echo "ERROR: GHCR owner is required through GHCR_OWNER or GITHUB_REPOSITORY_OWNER." >&2
  exit 2
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "ERROR: GH_TOKEN is required to clean GitHub Packages." >&2
  exit 2
fi

OWNER_TYPE="$(gh api "/users/${OWNER}" --jq '.type')"
if [[ "$OWNER_TYPE" == "Organization" ]]; then
  SCOPE="orgs"
else
  SCOPE="users"
fi

VERSIONS="$(gh api --paginate --slurp "/${SCOPE}/${OWNER}/packages/container/${PACKAGE}/versions?per_page=100")"

mapfile -t DELETE_IDS < <(
  jq -r '
    .[][]
    | .metadata.container.tags as $tags
    | select(
        ($tags | length) == 0
        or all($tags[]; test("^(sha-|dev-sha-|release-sha-|build-sha-)") )
      )
    | .id
  ' <<< "$VERSIONS"
)

if (( ${#DELETE_IDS[@]} == 0 )); then
  echo "GHCR cleanup: ${PACKAGE} has no untagged or legacy hash-only versions."
  exit 0
fi

for version_id in "${DELETE_IDS[@]}"; do
  echo "Deleting GHCR package version ${PACKAGE}/${version_id}"
  gh api --method DELETE "/${SCOPE}/${OWNER}/packages/container/${PACKAGE}/versions/${version_id}"
done

echo "GHCR cleanup completed for ${PACKAGE}: deleted ${#DELETE_IDS[@]} obsolete version(s)."
