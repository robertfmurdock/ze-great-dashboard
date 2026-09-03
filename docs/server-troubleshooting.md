# Server troubleshooting

This guide is for an engineer investigating a dashboard that cannot start, load its board, or read a panel. Server output is newline-delimited JSON: use it directly locally or in CloudWatch Logs.

| Symptom | Event | Safe next action |
| --- | --- | --- |
| Correlate a browser and server release | request-correlated events | Compare `serverVersion`, the browser's `clientVersion`, and `clientAssetPathMatchesConfigured`. A `false` match means the browser claims a different immutable asset path than this server selected. |
| Server does not start | `server.startup_failed` | Check the event category, then validate the asset path, board configuration, and required credentials. |
| Instance is publicly reachable without access control | `server.no_auth_warning` | Put the instance behind the intended gateway or configure the planned authentication boundary. |
| A panel says access is denied | `panel.observation_failed` with `errorKind: "unauthorized"` | Confirm the source credential exists and has read access; never paste a credential into logs or board YAML. |
| A panel says source not found | `panel.observation_failed` with `errorKind: "not-found"` | Check the source name, project/repository, workflow, and panel configuration. |
| A panel says source unavailable | `panel.observation_failed` with `errorKind: "unreachable"` | Check DNS, routing, firewall rules, and the source service’s availability. |
| A panel says its response is unreadable | `panel.observation_failed` with `errorKind: "upstream-error"` | Check the source’s API health and whether its response still matches the configured panel type. |
| A browser request is rejected | `api.operation_rejected` | Check the board and panel IDs. The proxy accepts only configured operations. |

The browser shows an opaque **support reference** for failed observations. It is the `requestId` of exactly one server event; it contains no source details or credentials.

## Event fields

- `event`: fixed event name.
- `serverVersion`: immutable server image identifier supplied at image build time; it is diagnostic
  evidence only and is never compared with `ASSET_PATH`.
- `clientVersion`, `clientOrigin`, `clientAssetPathMatchesConfigured`: browser-supplied diagnostic
  claims, normalized before logging. They are not authentication or authorization evidence. Origins
  retain only scheme, host, and port; malformed and absent claims are omitted.
- `requestId`: opaque server-generated support reference for an API request.
- `boardId`, `panelId`, `operation`: configured object and permitted operation being observed.
- `sourceName`, `sourceType`: configured source identity, when applicable.
- `destinationOrigin`: only scheme, host, and port of the upstream destination; paths and query strings are omitted.
- `errorKind`: one of `unreachable`, `unauthorized`, `not-found`, `no-runs`, or `upstream-error`.
- `upstreamStatus` and `networkCode`: present only when a safe status/code is known.
- `elapsedMs`: server-side observation duration.

Logs never include raw headers, response/request bodies, full URLs, query strings, credential names or values, raw exceptions, or stack traces.

## CloudWatch examples

In a CloudWatch Logs Insights query, locate a browser support reference:

```
fields @timestamp, event, requestId, boardId, panelId, errorKind, destinationOrigin, elapsedMs
| filter requestId = "paste-support-reference-here"
| sort @timestamp desc
```

Find failures for one panel:

```
fields @timestamp, requestId, errorKind, destinationOrigin, elapsedMs
| filter event = "panel.observation_failed" and panelId = "build"
| sort @timestamp desc
```

Use the resulting `requestId` when escalating to the dashboard operator. Do not add URLs, headers, tokens, or upstream payloads to the support reference.
