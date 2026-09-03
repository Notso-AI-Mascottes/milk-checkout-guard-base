# `actions/checkout` deleted-fork guard probe

This disposable repository measures whether `actions/checkout@v7.0.1` refuses
to check out a fork pull request after GitHub deletes the fork and emits a
`pull_request_target` `closed` event.

The repository contains no production credentials. `MILK_CANARY` is a fixed,
non-sensitive value used only to prove whether checked-out fork code executes
inside the privileged job.
