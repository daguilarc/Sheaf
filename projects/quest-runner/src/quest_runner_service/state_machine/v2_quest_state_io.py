"""Quest-root ``state.md`` I/O for v2: spec-normalized ``# State`` / ``## Tags``."""

from __future__ import annotations

from .. import quest_fs
from ..quest_service import FatalInvariantError
from ..quest_types import QuestState, QuestStateInfo, StateMachineState, slice_index_from_dirname
from .legacy_quest_state_io import LegacyQuestStateIo


class V2QuestStateIo(LegacyQuestStateIo):
    """Maps quest root to normalized state; slice dirs keep legacy slice ``state.md``."""

    def _read_quest(self) -> StateMachineState:
        info = quest_fs.read_quest_state(self.quest_dir)
        path = self.quest_dir / "state.md"
        text = path.read_text(encoding="utf-8")
        first: str | None = None
        for ln in text.splitlines():
            s = ln.strip()
            if not s:
                continue
            first = s
            break
        if first == "# State":
            sm = quest_fs.parse_normalized_state_md_text(
                text,
                require_global_step=False,
                label=f"normalized quest state file {path}",
            )
            try:
                QuestState(sm.state)
            except ValueError as e:
                raise FatalInvariantError(
                    f"Invalid quest state value {sm.state!r} in {path}"
                ) from e
            g = sm.global_step if sm.global_step is not None else 0
            return StateMachineState(
                machine_name=sm.machine_name,
                machine_path=sm.machine_path,
                state=sm.state,
                global_step=g,
                tags=sm.tags,
                updated_at=sm.updated_at,
            )
        rel = self.quest_dir.relative_to(self.repo_path).as_posix()
        tags: dict[str, str] = {}
        if info.active_slice:
            tags["active_slice"] = info.active_slice
        return StateMachineState(
            machine_name="quest",
            machine_path=rel,
            state=info.state.value,
            global_step=info.global_step if info.global_step is not None else 0,
            tags=tags,
            updated_at=info.updated_at,
        )

    def _write_quest(self, sm: StateMachineState) -> None:
        try:
            qs = QuestState(sm.state)
        except ValueError as e:
            raise FatalInvariantError(f"Invalid quest state {sm.state!r}") from e
        tags = dict(sm.tags)
        active = tags.get("active_slice")
        cs: int | None = None
        if qs == QuestState.ExecuteSlice:
            if active:
                idx = slice_index_from_dirname(active)
                if idx is None:
                    raise FatalInvariantError(
                        f"active_slice {active!r} must start with four-digit index"
                    )
                cs = idx
            else:
                cur = quest_fs.read_quest_state(self.quest_dir)
                cs = cur.current_slice
                if cs is None:
                    raise FatalInvariantError(
                        "ExecuteSlice requires active_slice tag or existing current_slice"
                    )
        store_active: str | None = active
        if qs not in (QuestState.ExecuteSlice, QuestState.PrepareNextSlice):
            store_active = None
        gs = sm.global_step if sm.global_step is not None else 0
        quest_fs.write_quest_normalized_machine_state(
            self.quest_dir,
            QuestStateInfo(
                state=qs,
                current_slice=cs,
                updated_at=sm.updated_at,
                active_slice=store_active,
                global_step=gs,
            ),
            self.meta,
            self.repo_path,
        )
