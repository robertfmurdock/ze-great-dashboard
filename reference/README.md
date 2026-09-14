# Release composition fixture

`consumer-composition.yml` instantiates the generated application template twice for release
validation: once with a Secrets Manager reference and once with a Parameter Store `SecureString`
reference. Both children receive the same Lambda artifact, dashboard version, asset base URL, and
board path, then expose their function ARNs for the health smoke test.

The `consumer-bootstrap-validation` job covers the separate account-bootstrap contract. Credential
path coverage belongs to this composition fixture.
