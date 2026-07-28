# Learning Log

Use this file to record what was learned after each working milestone.
The notes should be brief and written in your own words.

## Milestone 0: Project map

### What I can explain

- [ ] Why API Gateway is separate from Lambda
- [ ] Why the count must be stored outside Lambda
- [ ] Why Lambda needs an IAM execution role
- [ ] Where logs will appear

### Questions I still have

- Add questions here as they come up.

## Milestone 1: First cloud request

### Checkpoint 1A: Direct Lambda invocation

Verified facts:

- Region: `us-east-2`
- Runtime: Node.js 24
- Handler setting: `index.handler`
- Invocation type: synchronous
- Result: succeeded
- Response status: `200`
- Configured memory: 128 MB
- Observed invocation duration: approximately 41 ms
- Observed cold-start initialization: approximately 132 ms
- CloudWatch log group: `/aws/lambda/portfolio-visitor-api-dev`
- Application log: `request_received` with the test request ID
- Platform log sequence: `INIT_START`, `START`, `END`, and `REPORT`
- Current log retention: never expires

Reflection:

- [ ] Explain what `index.handler` means.
- [ ] Explain why Lambda needs an execution role.
- [ ] Explain why the test event included `requestContext.requestId`.
- [ ] Explain the difference between invocation duration and cold-start time.
- [ ] Explain the difference between platform logs and application logs.

### Checkpoint 1B: Persistent counter storage

Verified facts:

- Table: `portfolio-visitor-counter-dev`
- Status: active
- Capacity mode: on-demand
- Partition key: `counter_id` (String)
- Sort key: none
- Initial item: `counter_id = "total"`, `count = 0` (Number)
- Encryption at rest: AWS-owned key
- Point-in-time recovery: off
- Deletion protection: off
- Lambda access: not granted yet

Reflection:

- [ ] Explain why Lambda memory is not durable storage.
- [ ] Explain why `counter_id` is the partition key.
- [ ] Explain why `count` must use DynamoDB's Number type.
- [ ] Explain why on-demand capacity fits this early workload.
- [ ] Explain why table creation and IAM permission are separate steps.

### Checkpoint 1C: First API request

To be completed after API Gateway invokes Lambda.

- Request sent:
- Response received:
- DynamoDB change:
- CloudWatch evidence:
- Something that surprised me:
- Something I can now explain:
