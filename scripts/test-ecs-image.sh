#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE:?IMAGE is required}"
: "${ASSET_PATH:?ASSET_PATH is required}"

smoke_id="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
cluster_name="ze-great-dashboard-smoke-${smoke_id}"
task_family="ze-great-dashboard-smoke-${smoke_id}"
cluster_arn=''
task_definition_arn=''
task_arn=''

cleanup() {
  local test_status=$?
  local cleanup_status=0
  set +e

  if [ -n "$task_arn" ]; then
    if ! aws ecs stop-task --cluster "$cluster_arn" --task "$task_arn" \
      --reason 'CI smoke-test cleanup' --no-cli-pager >/dev/null; then
      echo 'ECS smoke-test cleanup failed while stopping the task' >&2
      cleanup_status=1
    fi
  fi
  if [ -n "$task_definition_arn" ]; then
    if ! aws ecs deregister-task-definition --task-definition "$task_definition_arn" \
      --no-cli-pager >/dev/null; then
      echo 'ECS smoke-test cleanup failed while deregistering the task definition' >&2
      cleanup_status=1
    fi
  fi
  if [ -n "$cluster_arn" ]; then
    if ! aws ecs delete-cluster --cluster "$cluster_arn" --no-cli-pager >/dev/null; then
      echo 'ECS smoke-test cleanup failed while deleting the cluster' >&2
      cleanup_status=1
    fi
  fi

  if [ "$cleanup_status" -ne 0 ]; then
    echo 'ECS smoke-test cleanup did not complete; inspect AWS resources with the smoke-test prefix.' >&2
    test_status=1
  fi
  exit "$test_status"
}
trap cleanup EXIT

subnet_id="$(aws ec2 describe-subnets \
  --filters Name=default-for-az,Values=true Name=state,Values=available \
  --query 'Subnets[?MapPublicIpOnLaunch==`true`]|[0].SubnetId' \
  --output text)"
test -n "$subnet_id" -a "$subnet_id" != None

cluster_arn="$(aws ecs create-cluster \
  --cluster-name "$cluster_name" \
  --query 'cluster.clusterArn' --output text)"

smoke_script='set -eu
tsx packages/server/src/node-server.ts >/tmp/dashboard.log 2>&1 &
server_pid=$!
cleanup_server() { kill "$server_pid" 2>/dev/null || true; }
trap cleanup_server EXIT
for attempt in $(seq 1 30); do
  if wget -q -O- http://127.0.0.1:3000/health >/dev/null; then exit 0; fi
  sleep 1
done
cat /tmp/dashboard.log
exit 1'

task_definition_arn="$(aws ecs register-task-definition \
  --family "$task_family" \
  --network-mode awsvpc \
  --requires-compatibilities FARGATE \
  --cpu 256 \
  --memory 512 \
  --container-definitions "$(jq -nc \
    --arg image "$IMAGE" \
    --arg command "$smoke_script" \
    --arg asset_path "$ASSET_PATH" \
    '[{name:"dashboard",image:$image,essential:true,command:["sh","-ec",$command],environment:[{name:"ASSET_PATH",value:$asset_path},{name:"BOARD_CONFIG_URL",value:"./boards/example.yaml"},{name:"TEMPLATE_WAIT_MS",value:"0"}]}]')" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"

task_arn="$(aws ecs run-task \
  --cluster "$cluster_arn" \
  --task-definition "$task_definition_arn" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$subnet_id],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)"
test -n "$task_arn" -a "$task_arn" != None

aws ecs wait tasks-stopped --cluster "$cluster_arn" --tasks "$task_arn"
task_result="$(aws ecs describe-tasks --cluster "$cluster_arn" --tasks "$task_arn" --output json)"
echo "$task_result" | jq '{lastStatus: .tasks[0].lastStatus, stopCode: .tasks[0].stopCode, stoppedReason: .tasks[0].stoppedReason, containers: .tasks[0].containers}'
exit_code="$(echo "$task_result" | jq -r '.tasks[0].containers[0].exitCode // 1')"
if [ "$exit_code" != 0 ]; then
  echo "ECS Docker smoke test failed with exit code $exit_code"
  exit 1
fi
