# Reference composition

`consumer-composition.yml` is an intentional consumer-composition fixture, not a second
application template. The release workflow uploads the generated application template once and
uses this checked-in parent stack to instantiate it twice: once with a Secrets Manager reference
and once with a Parameter Store `SecureString` reference. Both children receive the same Lambda
artifact, dashboard version, asset base URL, and board path, and expose their function ARNs as
parent outputs for the health smoke test.

The separate `consumer-bootstrap-validation` job remains separate because it validates a different
consumer account/bootstrap setup; it is not part of credential-path coverage.

Future direction: if more releases need this pattern, the AWS CLI could grow an explicit
composition interface that accepts a checked-in wrapper and its child parameter mappings. This
fixture deliberately exercises the current consumer contract without introducing that interface.
