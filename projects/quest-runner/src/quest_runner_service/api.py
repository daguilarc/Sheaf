"""Flask REST API for the Quest Runner service."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_sock import Sock

from . import dashboard_data
from . import dashboard_git
from . import dashboard_slice
from .dashboard_chat import ChatStreamSession
from .dashboard_data import DashboardBadRequest, DashboardNotFound
from .harness import HarnessNotAvailable
from . import quest_fs
from .quest_fs import StateFileParseError
from .issue_service import IssueNotFound
from .quest_service import (
    AdvanceQuestConflict,
    AdvanceQuestValidationError,
    ExperimentLandConflict,
    FatalInvariantError,
    InvalidProject,
    InvalidQuestInput,
    LandQuestConflict,
    MissingDefaultExecutionConfig,
    MissingQuestWorktree,
    NotAGitRepo,
    QuestLockContention,
    QuestNotFound,
    QuestService,
    RepoNotFound,
    SliceInitializationConflict,
)
from .experiments import ExperimentWorktreeCreationError
from .worktrees import WorktreeCreationError

log = logging.getLogger("quest_runner")
_DASHBOARD_ASSETS_DIR = Path(__file__).resolve().parent / "dashboard_assets"


def _no_cache(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


def create_app(
    quest_service: QuestService,
    source_repo_root: Path,
    started_at: float,
    shutdown_callback: Callable[[], None] | None = None,
) -> Flask:
    app = Flask(__name__)
    source_root = source_repo_root.resolve()
    sock = Sock(app)
    web_src_dir = source_root / "projects" / "web" / "src"

    @app.errorhandler(RepoNotFound)
    def handle_repo_not_found(exc):
        return jsonify({"error": str(exc)}), 404

    @app.errorhandler(NotAGitRepo)
    def handle_not_git_repo(exc):
        return jsonify({"error": str(exc)}), 422

    @app.errorhandler(InvalidProject)
    def handle_invalid_project(exc):
        return jsonify({"error": str(exc)}), 400

    @app.errorhandler(InvalidQuestInput)
    def handle_invalid_quest_input(exc):
        return jsonify({"error": str(exc)}), 400

    @app.errorhandler(QuestLockContention)
    def handle_lock_contention(exc):
        return jsonify({
            "error": str(exc),
            "repo_path": exc.repo_path,
            "lock_owner": {
                "quest_type": exc.lock_info.quest_type,
                "quest_number": exc.lock_info.quest_number,
                "request_id": exc.lock_info.request_id,
            },
        }), 409

    @app.errorhandler(QuestNotFound)
    def handle_quest_not_found(exc):
        return jsonify({"error": str(exc)}), 404

    @app.errorhandler(MissingQuestWorktree)
    def handle_missing_quest_worktree(exc):
        return jsonify({
            "error": str(exc),
            "project": exc.project,
            "quest_type": exc.quest_type,
            "quest_number": exc.quest_number,
            "expected_worktree": str(exc.worktree_path),
        }), 409

    @app.errorhandler(FatalInvariantError)
    def handle_fatal_invariant(exc):
        return jsonify({"error": str(exc)}), 500

    @app.errorhandler(MissingDefaultExecutionConfig)
    def handle_missing_default_execution_config(exc):
        return jsonify({"error": str(exc)}), 500

    @app.errorhandler(WorktreeCreationError)
    def handle_worktree_creation_error(exc):
        return jsonify({"error": str(exc)}), 500

    @app.errorhandler(ExperimentWorktreeCreationError)
    def handle_experiment_worktree_creation_error(exc):
        return jsonify({
            "error": str(exc),
            "metadata_commit": exc.metadata_commit,
            "branch_name": exc.branch_name,
            "worktree_path": str(exc.worktree_path),
            "experiment_dir": str(exc.experiment_dir),
        }), 500

    @app.errorhandler(HarnessNotAvailable)
    def handle_harness_not_available(exc):
        return jsonify({"error": str(exc)}), 503

    @app.errorhandler(StateFileParseError)
    def handle_state_file_parse_error(exc):
        return jsonify({"error": str(exc)}), 422

    @app.errorhandler(AdvanceQuestValidationError)
    def handle_advance_quest_validation(exc):
        return jsonify({"error": exc.message, "reason": exc.reason}), 422

    @app.errorhandler(AdvanceQuestConflict)
    def handle_advance_quest_conflict(exc):
        return jsonify({"error": exc.message}), 409

    @app.errorhandler(LandQuestConflict)
    def handle_land_quest_conflict(exc):
        return jsonify(exc.body), 409

    @app.errorhandler(ExperimentLandConflict)
    def handle_experiment_land_conflict(exc):
        return jsonify(exc.body), 409

    @app.errorhandler(SliceInitializationConflict)
    def handle_slice_initialization_conflict(exc):
        return jsonify({"error": str(exc)}), 409

    @app.errorhandler(dashboard_data.DashboardBadRequest)
    def handle_dashboard_bad_request(exc):
        body: dict = {"error": exc.message}
        if exc.fields:
            body["fields"] = exc.fields
        return jsonify(body), 400

    @app.errorhandler(dashboard_data.DashboardNotFound)
    def handle_dashboard_not_found(exc):
        return jsonify({"error": exc.message}), 404

    @app.errorhandler(IssueNotFound)
    def handle_issue_not_found(exc):
        return jsonify({"error": str(exc)}), 404

    @app.before_request
    def log_request() -> None:
        log.info("HTTP %s %s", request.method, request.path)

    @app.route("/health", methods=["GET"])
    def health():
        import time

        return jsonify({
            "healthy": True,
            "uptime": round(time.time() - started_at, 2),
        }), 200

    @app.route("/exit", methods=["POST"])
    def exit_service():
        if shutdown_callback is not None:
            shutdown_callback()
        else:
            import os
            import threading

            def _exit_process() -> None:
                os._exit(0)

            timer = threading.Timer(0.1, _exit_process)
            timer.daemon = True
            timer.start()
        return jsonify({"status": "exiting"}), 200

    @app.route("/experiments/create", methods=["POST"])
    def create_experiment_route():
        data = request.get_json(force=True)
        required = [
            "project",
            "quest_type",
            "quest_number",
            "start_step",
            "stop_node",
            "notes",
            "workflow_path",
        ]
        missing = [f for f in required if f not in data]
        if missing:
            return jsonify({"error": f"Missing required fields: {missing}"}), 400
        if not isinstance(data["quest_number"], int):
            return jsonify({"error": "quest_number must be an integer"}), 400
        if not isinstance(data["start_step"], int):
            return jsonify({"error": "start_step must be an integer"}), 400
        log.info(
            "create_experiment project=%s type=%s number=%s start_step=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
            data["start_step"],
        )
        result = quest_service.create_experiment(
            repo_path=str(source_root),
            project=data["project"],
            quest_type=data["quest_type"],
            quest_number=data["quest_number"],
            start_step=data["start_step"],
            stop_node=data["stop_node"],
            notes=data["notes"],
            workflow_path=data["workflow_path"],
            stop_machine_path=data.get("stop_machine_path"),
            requested_by=data.get("requested_by"),
            public_base_url=request.url_root,
        )
        log.info(
            "create_experiment ok experiment_id=%s worktree=%s",
            result.get("experiment_id"),
            result.get("worktree_path"),
        )
        return jsonify(result), 201

    @app.route("/experiments/land", methods=["POST"])
    def land_experiment_route():
        data = request.get_json(force=True)
        required = ["project", "quest_type", "quest_number", "experiment_id"]
        missing = [f for f in required if f not in data]
        if missing:
            return jsonify({"error": f"Missing required fields: {missing}"}), 400
        if not isinstance(data["quest_number"], int):
            return jsonify({"error": "quest_number must be an integer"}), 400
        log.info(
            "land_experiment project=%s type=%s number=%s experiment_id=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
            data["experiment_id"],
        )
        result = quest_service.land_experiment(
            repo_path=str(source_root),
            project=data["project"],
            quest_type=data["quest_type"],
            quest_number=data["quest_number"],
            experiment_id_value=data["experiment_id"],
            public_base_url=request.url_root,
        )
        log.info(
            "land_experiment ok experiment_id=%s status=%s",
            data["experiment_id"],
            result.get("status"),
        )
        return jsonify(result), 200

    @app.route("/create_quest", methods=["POST"])
    def create_quest_route():
        data = request.get_json(force=True)
        required = ["project", "quest_type", "name"]
        missing = [f for f in required if f not in data]
        if missing:
            return jsonify({"error": f"Missing required fields: {missing}"}), 400
        log.info(
            "create_quest project=%s type=%s name=%s",
            data["project"],
            data["quest_type"],
            data["name"],
        )
        result = quest_service.create_quest(
            repo_path=str(source_root),
            project=data["project"],
            quest_type=data["quest_type"],
            name=data["name"],
            slug=data.get("slug"),
            requested_by=data.get("requested_by"),
        )
        log.info(
            "create_quest ok project=%s type=%s number=%s worktree=%s",
            result["project"],
            result["quest_type"],
            result["quest_number"],
            result.get("worktree_path"),
        )
        return jsonify(result), 201

    @app.route("/run_quest", methods=["POST"])
    def run_quest_route():
        data = request.get_json(force=True)
        required = ["project", "quest_type", "quest_number"]
        missing = [f for f in required if f not in data]
        if missing:
            return jsonify({"error": f"Missing required fields: {missing}"}), 400
        try:
            max_steps = dashboard_data.parse_max_steps(data.get("max_steps"))
        except dashboard_data.DashboardBadRequest as exc:
            return jsonify({"error": exc.message, "fields": exc.fields}), 400
        log.info(
            "run_quest project=%s type=%s number=%s max_steps=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
            max_steps,
        )
        base = request.url_root
        result = quest_service.schedule_run_quest(
            repo_path=str(source_root),
            project=data["project"],
            quest_type=data["quest_type"],
            quest_number=data["quest_number"],
            max_steps=max_steps,
            public_base_url=base,
            experiment_id=data.get("experiment_id"),
        )
        log.info(
            "run_quest scheduled run_id=%s status=%s",
            result.get("run_id"),
            result.get("status"),
        )
        return jsonify(result), 202

    @app.route("/advance_quest", methods=["POST"])
    def advance_quest_route():
        data = request.get_json(force=True)
        required = ["project", "quest_type", "quest_number"]
        missing = [f for f in required if f not in data]
        if missing:
            return jsonify({"error": f"Missing required fields: {missing}"}), 400
        log.info(
            "advance_quest project=%s type=%s number=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
        )
        result = quest_service.advance_quest(
            repo_path=str(source_root),
            project=data["project"],
            quest_type=data["quest_type"],
            quest_number=data["quest_number"],
            experiment_id=data.get("experiment_id"),
        )
        log.info(
            "advance_quest ok project=%s type=%s number=%s status=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
            result.get("status"),
        )
        return jsonify(result), 200

    @app.route("/land", methods=["POST"])
    def land_route():
        data = request.get_json(force=True)
        required = ["project", "quest_type", "quest_number"]
        missing = [f for f in required if f not in data]
        if missing:
            return jsonify({"error": f"Missing required fields: {missing}"}), 400
        target_branch = data.get("target_branch", "main")
        log.info(
            "land project=%s type=%s number=%s target_branch=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
            target_branch,
        )
        result = quest_service.land_quest(
            repo_path=str(source_root),
            project=data["project"],
            quest_type=data["quest_type"],
            quest_number=data["quest_number"],
            target_branch=target_branch,
        )
        log.info(
            "land ok project=%s type=%s number=%s status=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
            result.get("status"),
        )
        return jsonify(result), 200

    @app.route("/upgrade_quest", methods=["POST"])
    def upgrade_quest_route():
        data = request.get_json(force=True)
        required = ["project", "quest_type", "quest_number"]
        missing = [f for f in required if f not in data]
        if missing:
            return jsonify({"error": f"Missing required fields: {missing}"}), 400
        log.info(
            "upgrade_quest project=%s type=%s number=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
        )
        result = quest_service.upgrade_quest(
            repo_path=str(source_root),
            project=data["project"],
            quest_type=data["quest_type"],
            quest_number=data["quest_number"],
            experiment_id=data.get("experiment_id"),
        )
        log.info(
            "upgrade_quest ok project=%s type=%s number=%s status=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
            result.get("status"),
        )
        return jsonify(result), 200

    @app.route("/api/slices/init", methods=["POST"])
    def initialize_slices_route():
        data = request.get_json(force=True)
        required = ["project", "quest_type", "quest_number", "count", "slugs"]
        missing = [f for f in required if f not in data]
        if missing:
            return jsonify({"error": f"Missing required fields: {missing}"}), 400
        log.info(
            "initialize_slices project=%s type=%s number=%s count=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
            data["count"],
        )
        result = quest_service.initialize_slices(
            repo_path=str(source_root),
            project=data["project"],
            quest_type=data["quest_type"],
            quest_number=data["quest_number"],
            count=data["count"],
            slugs=data["slugs"],
            experiment_id=data.get("experiment_id"),
            collection=data.get("collection"),
        )
        log.info(
            "initialize_slices ok project=%s type=%s number=%s created=%s",
            data["project"],
            data["quest_type"],
            data["quest_number"],
            len(result.get("created_slices", [])),
        )
        return jsonify(result), 201

    @app.route("/dashboard", methods=["GET"])
    def dashboard_shell():
        return _no_cache(
            send_from_directory(
                _DASHBOARD_ASSETS_DIR,
                "index.html",
                conditional=False,
                max_age=0,
            )
        )

    @app.route("/dashboard/assets/<path:filename>", methods=["GET"])
    def dashboard_static(filename: str):
        return _no_cache(
            send_from_directory(
                _DASHBOARD_ASSETS_DIR,
                filename,
                conditional=False,
                max_age=0,
            )
        )

    @app.route("/assets/web/<path:filename>", methods=["GET"])
    def web_static(filename: str):
        return _no_cache(
            send_from_directory(
                web_src_dir,
                filename,
                conditional=False,
                max_age=0,
            )
        )

    def _quest_context():
        project = dashboard_data.parse_project(
            request.args.get("project"),
            source_repo_root=source_root,
        )
        qt = dashboard_data.parse_quest_type(request.args.get("quest_type"))
        qn = dashboard_data.parse_quest_number(request.args.get("quest_number"))
        experiment_id = dashboard_data.parse_experiment_id(
            request.args.get("experiment_id")
        )
        checkout_root, qdir = dashboard_data.resolve_quest_dirs(
            source_root,
            project,
            qt,
            qn,
            experiment_id=experiment_id,
        )
        meta = quest_fs.read_quest_meta(qdir)
        checkout = dashboard_data.resolve_dashboard_checkout(
            source_root,
            meta,
            experiment_id=experiment_id,
        )
        return project, qt, qn, qdir, checkout.checkout_root, experiment_id

    @app.route("/api/dashboard/projects", methods=["GET"])
    def dashboard_projects():
        payload = dashboard_data.projects_payload(source_root)
        return jsonify(payload)

    @app.route("/api/dashboard/project_snapshot", methods=["GET"])
    def dashboard_project_snapshot():
        project = dashboard_data.parse_project(
            request.args.get("project"),
            source_repo_root=source_root,
        )
        payload = dashboard_data.project_snapshot_payload(
            source_repo_root=source_root,
            project=project,
            lock=quest_service.lock,
        )
        return jsonify(payload)

    @app.route("/api/dashboard/quest_overview", methods=["GET"])
    def dashboard_quest_overview():
        project, _qt, _qn, qdir, checkout_root, experiment_id = _quest_context()
        base = request.url_root
        payload = dashboard_data.quest_overview_payload(
            quest_dir=qdir,
            source_repo_root=source_root,
            checkout_root=checkout_root,
            project=project,
            lock=quest_service.lock,
            public_base_url=base,
            experiment_id=experiment_id,
        )
        return jsonify(payload)

    @app.route("/api/dashboard/experiments", methods=["GET"])
    def dashboard_experiments():
        project = dashboard_data.parse_project(
            request.args.get("project"),
            source_repo_root=source_root,
        )
        qt = dashboard_data.parse_quest_type(request.args.get("quest_type"))
        qn = dashboard_data.parse_quest_number(request.args.get("quest_number"))
        experiment_id = dashboard_data.parse_experiment_id(
            request.args.get("experiment_id")
        )
        if experiment_id is None:
            raise dashboard_data.DashboardBadRequest(
                "Missing required query parameter: experiment_id",
                fields={"experiment_id": "required"},
            )
        payload = dashboard_data.experiment_archive_detail_payload(
            source_repo_root=source_root,
            project=project,
            quest_type=qt,
            quest_number=qn,
            experiment_id=experiment_id,
        )
        return jsonify(payload)

    @app.route("/api/dashboard/physicalplan_issues", methods=["GET"])
    def dashboard_physicalplan_issues():
        _project, _qt, _qn, qdir, _checkout_root, _experiment_id = _quest_context()
        return jsonify(dashboard_data.physicalplan_issues_payload(qdir))

    @app.route("/api/dashboard/human_intervention", methods=["GET"])
    def dashboard_human_intervention():
        _project, _qt, _qn, qdir, _checkout_root, _experiment_id = _quest_context()
        return jsonify(dashboard_data.human_intervention_payload(qdir))

    @app.route("/api/dashboard/run_status", methods=["GET"])
    def dashboard_run_status():
        project, qt, qn, qdir, _checkout_root, experiment_id = _quest_context()
        payload = dashboard_data.run_status_payload(
            quest_dir=qdir,
            source_repo_root=source_root,
            project=project,
            quest_type=qt,
            quest_number=qn,
            lock=quest_service.lock,
            run_tracker=quest_service.run_tracker,
            experiment_id=experiment_id,
        )
        return jsonify(payload)

    @app.route("/api/dashboard/slice_page", methods=["GET"])
    def dashboard_slice_page():
        _project, _qt, _qn, qdir, _checkout_root, _experiment_id = _quest_context()
        sn = dashboard_slice.parse_slice_number(request.args.get("slice_number"))
        sub = dashboard_slice.parse_subpage(request.args.get("subpage"))
        payload = dashboard_slice.slice_page_payload(
            quest_dir=qdir,
            slice_number=sn,
            subpage=sub,
        )
        return jsonify(payload)

    @app.route("/api/dashboard/agent_steps", methods=["GET"])
    def dashboard_agent_steps():
        _project, _qt, _qn, qdir, _checkout_root, _experiment_id = _quest_context()
        return jsonify(dashboard_slice.agent_steps_payload(qdir))

    @app.route("/api/dashboard/agent_log", methods=["GET"])
    def dashboard_agent_log():
        _project, _qt, _qn, qdir, _checkout_root, _experiment_id = _quest_context()
        step = dashboard_slice.parse_optional_step(request.args.get("step"))
        payload = dashboard_slice.agent_log_payload(
            quest_dir=qdir,
            step=step,
        )
        return jsonify(payload)

    @sock.route("/api/dashboard/agent_log/stream")
    def dashboard_agent_log_stream(ws):
        try:
            _project, _qt, _qn, qdir, _checkout_root, _experiment_id = _quest_context()
            step = dashboard_slice.parse_optional_step(request.args.get("step"))
            _step_num, log_path = dashboard_slice.resolve_agent_log_path(
                quest_dir=qdir,
                step=step,
            )
        except (DashboardBadRequest, DashboardNotFound) as exc:
            ws.send(json.dumps({"type": "error", "message": str(exc)}))
            return
        except Exception:
            log.exception("agent_log stream setup failed")
            ws.send(json.dumps({"type": "error", "message": "Internal server error"}))
            return

        ChatStreamSession(
            log_path=log_path,
            ws=ws,
            event_bus=quest_service.chat_event_bus,
        ).run()

    @app.route("/api/dashboard/git_commits", methods=["GET"])
    def dashboard_git_commits():
        _project, _qt, _qn, _qdir, checkout_root, _experiment_id = _quest_context()
        limit = dashboard_git.parse_limit(request.args.get("limit"))
        skip = dashboard_git.parse_skip(request.args.get("skip"))
        payload = dashboard_git.git_commits_payload(
            checkout_root, limit=limit, skip=skip
        )
        return jsonify(payload)

    def _issue_quest_params_from_query() -> dict:
        project = dashboard_data.parse_project(
            request.args.get("project"),
            source_repo_root=source_root,
        )
        quest_type = dashboard_data.parse_quest_type(request.args.get("quest_type"))
        quest_number = dashboard_data.parse_quest_number(
            request.args.get("quest_number")
        )
        return {
            "project": project,
            "quest_type": quest_type,
            "quest_number": quest_number,
            "experiment_id": dashboard_data.parse_experiment_id(
                request.args.get("experiment_id")
            ),
        }

    def _issue_quest_params_from_body(data: dict) -> dict:
        required = ["project", "quest_type", "quest_number", "issue_file"]
        missing = [f for f in required if f not in data]
        if missing:
            raise dashboard_data.DashboardBadRequest(
                f"Missing required fields: {missing}",
                fields={f: "required" for f in missing},
            )
        project = dashboard_data.parse_project(
            data["project"],
            source_repo_root=source_root,
        )
        quest_type = dashboard_data.parse_quest_type(data["quest_type"])
        if not isinstance(data["quest_number"], int) or data["quest_number"] < 0:
            raise dashboard_data.DashboardBadRequest(
                "quest_number must be a non-negative integer",
                fields={"quest_number": "invalid"},
            )
        return {
            "project": project,
            "quest_type": quest_type,
            "quest_number": data["quest_number"],
            "issue_file_raw": data["issue_file"],
            "owner_role_raw": data.get("owner_role"),
            "experiment_id": data.get("experiment_id"),
        }

    @app.route("/api/issues", methods=["GET"])
    def list_issues_route():
        params = _issue_quest_params_from_query()
        status_filter = request.args.get("status")
        result = quest_service.list_issues(
            repo_path=str(source_root),
            project=params["project"],
            quest_type=params["quest_type"],
            quest_number=params["quest_number"],
            issue_file_raw=request.args.get("issue_file"),
            status_filter=status_filter or "all",
            experiment_id=params.get("experiment_id"),
        )
        return jsonify(result), 200

    @app.route("/api/issues/<issue_id>", methods=["GET"])
    def get_issue_route(issue_id: str):
        params = _issue_quest_params_from_query()
        result = quest_service.get_issue(
            repo_path=str(source_root),
            issue_id=issue_id,
            project=params["project"],
            quest_type=params["quest_type"],
            quest_number=params["quest_number"],
            issue_file_raw=request.args.get("issue_file"),
            experiment_id=params.get("experiment_id"),
        )
        return jsonify(result), 200

    @app.route("/api/issues", methods=["POST"])
    def create_issue_route():
        data = request.get_json(force=True)
        params = _issue_quest_params_from_body(data)
        title = data.get("title", "")
        body = data.get("body", data.get("details", ""))
        status = data.get("status", "open")
        result = quest_service.create_issue(
            repo_path=str(source_root),
            project=params["project"],
            quest_type=params["quest_type"],
            quest_number=params["quest_number"],
            issue_file_raw=params["issue_file_raw"],
            title=title,
            body=body,
            status=status,
            owner_role_raw=params.get("owner_role_raw"),
            experiment_id=params.get("experiment_id"),
        )
        return jsonify(result), 201

    @app.route("/api/issues/<issue_id>", methods=["PATCH"])
    def edit_issue_route(issue_id: str):
        data = request.get_json(force=True)
        params = _issue_quest_params_from_body(data)
        result = quest_service.edit_issue(
            repo_path=str(source_root),
            issue_id=issue_id,
            project=params["project"],
            quest_type=params["quest_type"],
            quest_number=params["quest_number"],
            issue_file_raw=params["issue_file_raw"],
            status=data.get("status"),
            title=data.get("title"),
            body=data.get("body", data.get("details")),
            experiment_id=params.get("experiment_id"),
        )
        return jsonify(result), 200

    @app.route("/api/issues/<issue_id>/responses", methods=["POST"])
    def respond_to_issue_route(issue_id: str):
        data = request.get_json(force=True)
        params = _issue_quest_params_from_body(data)
        outcome = data.get("outcome", "")
        explanation = data.get("explanation", "")
        result = quest_service.respond_to_issue(
            repo_path=str(source_root),
            issue_id=issue_id,
            project=params["project"],
            quest_type=params["quest_type"],
            quest_number=params["quest_number"],
            issue_file_raw=params["issue_file_raw"],
            outcome=outcome,
            explanation=explanation,
            experiment_id=params.get("experiment_id"),
        )
        return jsonify(result), 201

    @app.route("/api/issues/<issue_id>/responses", methods=["GET"])
    def list_issue_responses_route(issue_id: str):
        params = _issue_quest_params_from_query()
        result = quest_service.list_issue_responses(
            repo_path=str(source_root),
            issue_id=issue_id,
            project=params["project"],
            quest_type=params["quest_type"],
            quest_number=params["quest_number"],
            issue_file_raw=request.args.get("issue_file"),
            experiment_id=params.get("experiment_id"),
        )
        return jsonify(result), 200

    @app.route("/api/dashboard/git_diff", methods=["GET"])
    def dashboard_git_diff():
        _project, _qt, _qn, _qdir, checkout_root, _experiment_id = _quest_context()
        commit = request.args.get("commit")
        if commit is None or not str(commit).strip():
            raise dashboard_data.DashboardBadRequest(
                "Missing required query parameter: commit",
                fields={"commit": "required"},
            )
        path = request.args.get("path")
        if path is not None and str(path).strip():
            payload = dashboard_git.git_diff_file_payload(
                checkout_root, commit.strip(), str(path).strip()
            )
        else:
            payload = dashboard_git.git_diff_summary_payload(
                checkout_root, commit.strip()
            )
        return jsonify(payload)

    return app
