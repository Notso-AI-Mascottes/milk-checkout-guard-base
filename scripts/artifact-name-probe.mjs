#!/usr/bin/env node

import {createHash} from 'node:crypto'
import {appendFile, writeFile} from 'node:fs/promises'

const runtimeToken = process.env.ACTIONS_RUNTIME_TOKEN
const resultsUrl = process.env.ACTIONS_RESULTS_URL
const runId = process.env.GITHUB_RUN_ID
const outputPath = process.env.GITHUB_OUTPUT

if (!runtimeToken || !resultsUrl || !runId || !outputPath) {
  throw new Error('This probe must run inside a GitHub Actions job')
}

const payload = JSON.parse(
  Buffer.from(runtimeToken.split('.')[1], 'base64url').toString('utf8')
)
const resultsScope = String(payload.scp ?? '')
  .split(' ')
  .find(scope => scope.startsWith('Actions.Results:'))

if (!resultsScope) {
  throw new Error('The runtime token has no Actions.Results scope')
}

const [, workflowRunBackendId, workflowJobRunBackendId] =
  resultsScope.split(':')
const service = 'github.actions.results.api.v1.ArtifactService'

const cases = [
  ['control', 'raw-control.txt'],
  ['dot', '.'],
  ['dot-dot', '..'],
  ['three-dots', '...'],
  ['dot-space', '. '],
  ['dot-dot-space', '.. '],
  ['space-dot-dot', ' ..'],
  ['percent-dot-dot', '%2e%2e'],
  ['percent-dot-dot-slash', '%2e%2e%2fescaped.txt'],
  ['percent-dot-dot-backslash', '%2e%2e%5cescaped.txt'],
  ['double-percent-traversal', '%252e%252e%252fescaped.txt'],
  ['forward-traversal', '../escaped.txt'],
  ['backward-traversal', '..\\escaped.txt'],
  ['absolute-posix', '/tmp/milk-artifact-name-escaped.txt'],
  ['absolute-drive', 'D:\\milk-artifact-name-escaped.txt'],
  ['drive-relative', 'D:milk-artifact-name-escaped.txt'],
  ['extended-drive', '\\\\?\\D:\\milk-artifact-name-escaped.txt'],
  ['unc', '\\\\localhost\\D$\\milk-artifact-name-escaped.txt'],
  ['reserved-con', 'CON'],
  ['reserved-nul', 'NUL'],
  ['reserved-com1', 'COM1'],
  ['alternate-stream', 'safe.txt:escaped'],
  ['trailing-dot', 'trailing.'],
  ['trailing-space', 'trailing '],
  ['semicolon', 'safe; filename=..'],
  ['quote-confusion', 'safe"; filename=..; x="'],
  ['filename-star-confusion', "safe; filename*=UTF-8''%2e%2e%2fescaped.txt"],
  ['line-feed', 'line\nfeed'],
  ['carriage-return', 'carriage\rreturn'],
  ['unicode-slash', 'parent∕..∕escaped.txt'],
  ['unicode-dot-leader', '․․'],
  ['fullwidth-dot', '．．']
]

async function twirp(method, body) {
  const url = new URL(`/twirp/${service}/${method}`, resultsUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtimeToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {message: text.slice(0, 500)}
  }
  return {status: response.status, body: parsed}
}

function safeError(body) {
  const value = body?.msg ?? body?.message ?? JSON.stringify(body)
  return String(value).replaceAll(/https?:\/\/\S+/g, '[URL]').slice(0, 500)
}

const results = []
const accepted = []

for (const [id, name] of cases) {
  const marker = `MILK-ARTIFACT-NAME:${runId}:${id}`
  const bytes = Buffer.from(`${marker}\n`, 'utf8')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const result = {id, name, marker}

  const created = await twirp('CreateArtifact', {
    workflow_run_backend_id: workflowRunBackendId,
    workflow_job_run_backend_id: workflowJobRunBackendId,
    name,
    version: 7,
    mime_type: 'text/plain'
  })
  result.create_status = created.status

  const uploadUrl = created.body?.signed_upload_url
  if (created.status !== 200 || created.body?.ok !== true || !uploadUrl) {
    result.create_error = safeError(created.body)
    results.push(result)
    continue
  }

  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
      'x-ms-blob-type': 'BlockBlob'
    },
    body: bytes
  })
  result.upload_status = upload.status
  if (!upload.ok) {
    result.upload_error = (await upload.text()).slice(0, 500)
    results.push(result)
    continue
  }

  const finalized = await twirp('FinalizeArtifact', {
    workflow_run_backend_id: workflowRunBackendId,
    workflow_job_run_backend_id: workflowJobRunBackendId,
    name,
    size: String(bytes.length),
    hash: `sha256:${hash}`
  })
  result.finalize_status = finalized.status
  if (finalized.status !== 200 || finalized.body?.ok !== true) {
    result.finalize_error = safeError(finalized.body)
    results.push(result)
    continue
  }

  result.artifact_id = String(finalized.body.artifact_id)
  result.sha256 = hash
  accepted.push({
    id,
    name,
    marker,
    artifact_id: result.artifact_id
  })
  results.push(result)
}

await writeFile(
  'artifact-name-probe-results.json',
  `${JSON.stringify({cases: results}, null, 2)}\n`
)
await appendFile(outputPath, `matrix=${JSON.stringify(accepted)}\n`)
console.log(
  `Backend accepted and finalized ${accepted.length} of ${cases.length} candidate artifact names.`
)
