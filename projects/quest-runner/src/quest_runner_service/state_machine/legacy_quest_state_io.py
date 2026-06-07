"""Map legacy quest/slice ``state.md`` to :class:`StateMachineState` for v2 machines."""

from __future__ import annotations

from pathlib import Path

from .. import quest_fs
from ..quest_service import FatalInvariantError
from ..quest_types import (
    QuestMeta,
    QuestState,
    QuestStateInfo,
    SliceState,
    SliceStateInfo,
    StateMachineState,
    slice_index_from_dirname,
)


class LegacyQuestStateIo:
    """``StateIo`` for the quest root directory and nested slice directories."""

    def __init__(self, repo_path: Path, quest_dir: Path, meta: QuestMeta) -> None:
        self.repo_path = repo_path.resolve()
        self.quest_dir = quest_dir.resolve()
        self.meta = meta

    def ReadStateMachineState(self, state_machine_dir: Path) -> StateMachineState:
        p = state_machine_dir.resolve()
        if p == self.quest_dir:
            return self._read_quest()
        return self._read_slice(p)

    def WriteStateMachineState(
        self, state_machine_dir: Path, state: StateMachineState
    ) -> None:
        p = state_machine_dir.resolve()
        if p == self.quest_dir:
            self._write_quest(state)
        else:
            self._write_slice(p, state)

    def _read_quest(self) -> StateMachineState:
        info = quest_fs.read_quest_state(self.quest_dir)
        rel = self.quest_dir.relative_to(self.repo_path).as_posix()
        tags: dict[str, str] = {}
        if info.active_slice:
            tags["active_slice"] = info.active_slice
        return StateMachineState(
            machine_name="quest",
            machine_path=rel,
            state=info.state.value,
            global_step=info.global_step,
            tags=tags,
            updated_at=info.updated_at,
        )

    def _read_slice(self, slice_dir: Path) -> StateMachineState:
        s = quest_fs.read_slice_state(slice_dir)
        rel = slice_dir.relative_to(self.repo_path).as_posix()
        logical = (
            "SliceSetup"
            if s.state == SliceState.NotStarted
            else ("Completed" if s.state == SliceState.Done else s.state.value)
        )
        return StateMachineState(
            machine_name=f"slice_{slice_dir.name}",
            machine_path=rel,
            state=logical,
            global_step=None,
            tags={},
            updated_at=s.updated_at,
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
        quest_fs.write_quest_state(
            self.quest_dir,
            QuestStateInfo(
                state=qs,
                current_slice=cs,
                updated_at=sm.updated_at,
                active_slice=store_active,
                global_step=sm.global_step,
            ),
        )

    def _write_slice(self, slice_dir: Path, sm: StateMachineState) -> None:
        if sm.state == "SliceSetup":
            ss = SliceState.NotStarted
        elif sm.state == "Completed":
            ss = SliceState.Done
        else:
            try:
                ss = SliceState(sm.state)
            except ValueError as e:
                raise FatalInvariantError(
                    f"Invalid slice state {sm.state!r} for {slice_dir}"
                ) from e
        quest_fs.write_slice_state(
            slice_dir,
            SliceStateInfo(state=ss, updated_at=sm.updated_at),
        )
