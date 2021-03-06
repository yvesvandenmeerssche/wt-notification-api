#!/bin/bash

ENVIRONMENT=$1

# AWS command opts
TASK_FAMILY="$ENVIRONMENT-wt-update-api"
SERVICE_NAME="$ENVIRONMENT-wt-update-api"
AWS_REGION="eu-west-1"

# container setup options
LATEST_TAG=`git describe --abbrev=0 --tags`

# container startup options
WT_CONFIG=$ENVIRONMENT

TASK_DEF="[{\"portMappings\": [{\"hostPort\": 0,\"protocol\": \"tcp\",\"containerPort\": 8080}],
    \"environment\": [
      {
        \"name\": \"WT_API_BASE_URL\",
        \"value\": \"https://$ENVIRONMENT-update-api.windingtree.com\"
      },
      {
        \"name\": \"WT_CONFIG\",
        \"value\": \"$WT_CONFIG\"
      }
    ],
    \"image\": \"029479441096.dkr.ecr.eu-west-1.amazonaws.com/wt-update-api:$LATEST_TAG-$ENVIRONMENT\",
    \"name\": \"wt-update-api\",
    \"memoryReservation\": 128,
    \"cpu\": 128
  }]"

echo "Updating task definition"
aws ecs register-task-definition --region $AWS_REGION --family $TASK_FAMILY --container-definitions "$TASK_DEF" > /dev/null
echo "Updating service"
aws ecs update-service --region $AWS_REGION --cluster shared-docker-cluster-t3 --service "$SERVICE_NAME" --task-definition "$TASK_FAMILY" > /dev/null
