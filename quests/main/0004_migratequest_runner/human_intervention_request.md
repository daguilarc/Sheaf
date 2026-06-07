# Human intervention requested

**Reason:** Polisher cannot remove tracked bytecode artifacts from the git index because repository metadata writes are blocked in this sandbox.

PI-0001 requires `git ls-files projects/quest-runner | grep -E 'pyc|__pycache__'` to return nothing. I added the ignore rules and removed all bytecode files from the working tree, but removing them from tracking requires updating `.git/index`.

Commands attempted:

```text
git ls-files -z 'projects/quest-runner/**/__pycache__/*' 'projects/quest-runner/**/*.pyc' | xargs -0 git rm -f
git update-index --force-remove projects/quest-runner/src/quest_runner_service/__pycache__/__init__.cpython-314.pyc
```

Both failed with:

```text
fatal: Unable to create '/Users/joyo/Sheaf/.git/index.lock': Operation not permitted
```

Manual action needed in an environment that can write `.git/index`: stage deletion of the 33 tracked `projects/quest-runner/**/__pycache__/*.pyc` files, then verify:

```text
git ls-files projects/quest-runner | grep -E 'pyc|__pycache__'
```
