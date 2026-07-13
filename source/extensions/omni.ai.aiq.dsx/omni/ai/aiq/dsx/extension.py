## Copyright (c) 2025, NVIDIA CORPORATION.  All rights reserved.
##
## NVIDIA CORPORATION and its licensors retain all intellectual property
## and proprietary rights in and to this software, related documentation
## and any modifications thereto.

import inspect
import importlib.machinery
import os
import sys
from copy import deepcopy
from pathlib import Path
from typing import Optional

import carb
import carb.settings
import omni.ext
import omni.kit.app

from .http_server import start_http_server, stop_http_server, set_kit_event_loop, set_lc_agent_refs

# Kit's global pip archive preloads websockets 12, while the bundled NAT
# runtime requires its own newer websockets package.  Once Python caches the
# older package, NAT submodules otherwise resolve against a mixture of both
# versions (missing backoff, InvalidProxyMessage, and related APIs).  Prefer
# the NAT prebundle before importing any NAT modules below.
_nat_prebundle = next(
    (path for path in sys.path if path.endswith("omni.ai.langchain.nat/pip_nat_prebundle")),
    None,
)
if not _nat_prebundle:
    # The extension is imported before Kit adds the NAT extension's pip folder
    # to sys.path on some startup orders.  Locate the release/debug bundle from
    # this source checkout so the dependency set is still deterministic.
    for _ancestor in Path(__file__).resolve().parents:
        for _config in ("release", "debug"):
            _candidate = (
                _ancestor
                / "_build"
                / "linux-x86_64"
                / _config
                / "exts"
                / "omni.ai.langchain.nat"
                / "pip_nat_prebundle"
            )
            if _candidate.is_dir():
                _nat_prebundle = str(_candidate)
                break
        if _nat_prebundle:
            break
if _nat_prebundle:
    if _nat_prebundle in sys.path:
        sys.path.remove(_nat_prebundle)
    sys.path.insert(0, _nat_prebundle)

    class _NATWebsocketsFinder:
        """Resolve websockets exclusively from NAT ahead of Kit's pip finder."""

        def find_spec(self, fullname, path=None, target=None):
            if fullname == "websockets":
                search_path = [_nat_prebundle]
            elif fullname.startswith("websockets."):
                package_parts = fullname.split(".")[1:-1]
                search_path = [str(Path(_nat_prebundle, "websockets", *package_parts))]
            else:
                return None
            return importlib.machinery.PathFinder.find_spec(fullname, search_path)

    sys.meta_path.insert(0, _NATWebsocketsFinder())
    for _module_name in list(sys.modules):
        if _module_name == "websockets" or _module_name.startswith("websockets."):
            del sys.modules[_module_name]
    # Import immediately while this path is first. Kit may reorder extension
    # pip paths while later NAT modules are being discovered.
    import websockets as _nat_websockets
    print(f"[omni.ai.aiq.dsx] Using NAT websockets from {_nat_websockets.__file__}")

# Lazy imports — these may not be available depending on which extensions are loaded
load_and_override_config = None
PluginTypes = None
discover_and_register_plugins = None
get_node_factory = None
RunnableNATNode = None
replace_md_file_references = None

_AI_IMPORTS_AVAILABLE = False

try:
    from nat.cli.cli_utils.config_override import load_and_override_config
    from nat.runtime.loader import PluginTypes, discover_and_register_plugins
    from lc_agent import get_node_factory, RunnableNetwork, RunnableHumanNode
    from .utils.config_utils import replace_md_file_references
    _AI_IMPORTS_AVAILABLE = True
    # Cache lc_agent refs for daemon threads (HTTP handler)
    set_lc_agent_refs(get_node_factory, RunnableNetwork, RunnableHumanNode)
    print("[omni.ai.aiq.dsx] Core AI imports (nat, lc_agent) loaded successfully")
except ImportError as e:
    print(f"[omni.ai.aiq.dsx] Core AI imports not available: {e}")
    import traceback
    traceback.print_exc()

try:
    from lc_agent_nat import RunnableNATNode
    # Register NAT components (NIM LLM, LangChain plugins) — same as ChatUSD does
    from lc_agent_nat.register import *  # noqa: F401,F403
    print("[omni.ai.aiq.dsx] lc_agent_nat.RunnableNATNode imported successfully")
except ImportError as e:
    RunnableNATNode = None
    print(f"[omni.ai.aiq.dsx] lc_agent_nat not available: {e}")

try:
    from nat.llm.nim_llm import *  # noqa: F401,F403 — registers NIM LLM type
    from nat.plugins.langchain.register import *  # noqa: F401,F403 — registers LangChain plugins
    print("[omni.ai.aiq.dsx] NAT LLM and plugin registrations loaded")
except ImportError as e:
    print(f"[omni.ai.aiq.dsx] NAT LLM/plugin registrations not available: {e}")

# USD functions to copy from usdcode to dsxcode
USD_FUNCTIONS_TO_COPY = ["set_selection", "set_translate", "set_scale", "set_rotate"]

_BASE_NAT_CONFIG = None
_EXTENSION_PATH: Optional[Path] = None


def _get_extension_path() -> Optional[Path]:
    global _EXTENSION_PATH
    if _EXTENSION_PATH:
        return _EXTENSION_PATH
    app = omni.kit.app.get_app()
    if not app:
        return None
    extension_manager = app.get_extension_manager()
    extension_path_str = extension_manager.get_extension_path_by_module(__name__)
    if not extension_path_str:
        return None
    _EXTENSION_PATH = Path(extension_path_str)
    return _EXTENSION_PATH


def _load_base_aiq_config():
    """Load workflow.yaml as a raw dict with markdown file references resolved.

    We intentionally bypass ``load_and_override_config`` (which creates Pydantic
    model objects).  The ``RunnableNATNode`` internally calls
    ``Config.model_validate()`` on the dict, and if it receives or re-validates
    already-instantiated Config objects the bare discriminator tag from
    ``name="DsxCodeInteractive"`` fails the union check.  Keeping the config as
    a plain dict avoids this entirely.
    """
    global _BASE_NAT_CONFIG
    if _BASE_NAT_CONFIG is not None:
        return _BASE_NAT_CONFIG
    extension_path = _get_extension_path()
    if not extension_path:
        carb.log_error("Unable to resolve DSX extension path.")
        return None
    workflow_path = extension_path / "data" / "workflow.yaml"
    if not workflow_path.exists():
        carb.log_error(f"DSX workflow file not found at: {workflow_path}")
        return None
    try:
        import yaml
        with open(workflow_path, "r", encoding="utf-8") as f:
            nat_config = yaml.safe_load(f)
        # Resolve {path/to/file.md} references in string values
        nat_config = replace_md_file_references(nat_config, extension_path)
        _BASE_NAT_CONFIG = nat_config
        print(f"[omni.ai.aiq.dsx] Loaded workflow.yaml as raw dict. _type values: "
              f"workflow={nat_config.get('workflow', {}).get('_type')}, "
              f"functions={[f.get('_type') for f in nat_config.get('functions', {}).values()]}")
    except Exception as e:
        carb.log_error(f"Failed to load DSX workflow config: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return None
    return _BASE_NAT_CONFIG


def build_aiq_config():
    """Return the workflow config as a plain dict for RunnableNATNode registration."""
    base_config = _load_base_aiq_config()
    if base_config is None:
        return None
    # Return a deep copy so callers can't mutate the cached config
    return deepcopy(base_config)


def refresh_dsx_aiq() -> bool:
    if RunnableNATNode is None:
        carb.log_warn("LangChain agent not installed, skipping DSX AIQ registration")
        return False
    nat_config = build_aiq_config()
    if nat_config is None:
        return False
    try:
        try:
            get_node_factory().unregister("DSX Agent AIQ")
        except Exception:
            pass
        get_node_factory().register(RunnableNATNode, name="DSX Agent AIQ", nat_config=nat_config)
        carb.log_info("DSX Agent AIQ registered successfully")
        return True
    except Exception as e:
        carb.log_error(f"Failed to register DSX Agent AIQ: {e}")
        return False


def copy_usd_functions_to_modules():
    try:
        import dsxcode
        import dsxinfo
        import usdcode
        from dsxcode import storage
        from usdcode import usd_meta_functions_get

        def copy_to_module(target_module, module_name, functions_to_copy):
            copied_count = 0
            for name, obj in vars(usd_meta_functions_get).items():
                if name.startswith("_"):
                    continue
                if inspect.isfunction(obj) or inspect.iscoroutinefunction(obj):
                    setattr(target_module, name, obj)
                    copied_count += 1
            carb.log_info(f"Copied {copied_count} functions from usd_meta_functions_get to {module_name}")

            for func_name in functions_to_copy:
                if hasattr(usdcode, func_name):
                    func_obj = getattr(usdcode, func_name)
                    if inspect.isfunction(func_obj) or inspect.iscoroutinefunction(func_obj):
                        setattr(target_module, func_name, func_obj)

        copy_to_module(dsxcode, "dsxcode", USD_FUNCTIONS_TO_COPY)
        copy_to_module(dsxinfo, "dsxinfo", [])

        # Copy storage functions
        storage_functions = ["set_storage", "get_storage", "clear_storage", "list_storage_keys"]
        for func_name in storage_functions:
            if hasattr(storage, func_name):
                func_obj = getattr(storage, func_name)
                setattr(dsxcode, func_name, func_obj)
                setattr(dsxinfo, func_name, func_obj)

        carb.log_info("DSX function injection complete")
    except ImportError as e:
        carb.log_error(f"Failed to import modules for DSX function injection: {e}")
    except Exception as e:
        carb.log_error(f"Error in DSX function injection: {e}")


class DSXAgentExtension(omni.ext.IExt):

    def on_startup(self, ext_id):
        print("[omni.ai.aiq.dsx] Extension on_startup called")
        self._registered = False
        self._http_server = None


        # Capture Kit's event loop (we're on the main thread during on_startup)
        import asyncio
        try:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.get_event_loop()
            set_kit_event_loop(loop)
            print(f"[omni.ai.aiq.dsx] Captured Kit event loop (running={loop.is_running()})")
        except Exception as e:
            print(f"[omni.ai.aiq.dsx] Could not capture event loop: {e}")

        # Always start the HTTP server first so we can test connectivity
        try:
            self._http_server = start_http_server()
            port = int(os.environ.get("DSX_AGENT_PORT", 8012))
            print(f"[omni.ai.aiq.dsx] HTTP server started on port {port}")
        except Exception as e:
            print(f"[omni.ai.aiq.dsx] Failed to start HTTP server: {e}")

        if not _AI_IMPORTS_AVAILABLE or RunnableNATNode is None:
            reason = "core AI imports missing" if not _AI_IMPORTS_AVAILABLE else "lc_agent_nat not available"
            print(f"[omni.ai.aiq.dsx] AI agent disabled ({reason}) — HTTP server running for basic responses")
            carb.log_warn(f"DSX Agent AIQ disabled: {reason}. HTTP server still running on port {port}.")
            return

        try:
            from .nodes import (
                DsxCodeInteractiveGen,
                DsxCodeInteractiveNetworkNode,
                DsxInfoGen,
                DsxInfoNetworkNode,
            )

            # Import the register module so @register_function decorators execute
            from .dsx_aiq_register import (  # noqa: F401
                dsx_code_interactive_function,
                dsx_info_function,
                dsx_multi_agent_function,
            )

            # Discover and register AIQ plugins
            discover_and_register_plugins(PluginTypes.CONFIG_OBJECT)
            print("[omni.ai.aiq.dsx] Plugins discovered")

            # Register custom lc_agent nodes with the node factory
            get_node_factory().register(
                DsxCodeInteractiveGen, name="DsxCodeInteractiveGen", hidden=True
            )
            get_node_factory().register(
                DsxCodeInteractiveNetworkNode,
                name="DsxCodeInteractive",
                default_node="DsxCodeInteractiveGen",
            )
            get_node_factory().register(
                DsxInfoGen, name="DsxInfoGen", hidden=True
            )
            get_node_factory().register(
                DsxInfoNetworkNode,
                name="DsxInfo",
                default_node="DsxInfoGen",
            )
            print("[omni.ai.aiq.dsx] Custom DSX nodes registered")

            if _load_base_aiq_config() is None:
                print("[omni.ai.aiq.dsx] Failed to load AIQ config — agent disabled but HTTP server running")
                return

            if not refresh_dsx_aiq():
                print("[omni.ai.aiq.dsx] Failed to register DSX Agent AIQ — agent disabled but HTTP server running")
                return

            self._registered = True

            # Copy USD functions to dsxcode and dsxinfo modules
            copy_usd_functions_to_modules()

            print("[omni.ai.aiq.dsx] DSX Agent extension fully started — AIQ registered + HTTP server running")
            carb.log_info("DSX Agent extension started successfully with full AI capabilities")

        except Exception as e:
            print(f"[omni.ai.aiq.dsx] Error during AI agent setup (HTTP server still running): {e}")
            import traceback
            traceback.print_exc()

    def on_shutdown(self):
        print("[omni.ai.aiq.dsx] Extension shutting down")
        if self._http_server:
            stop_http_server(self._http_server)
            self._http_server = None

        if hasattr(self, "_registered") and self._registered:
            try:
                get_node_factory().unregister("DSX Agent AIQ")
            except Exception:
                pass
            self._registered = False

        carb.log_info("DSX Agent extension shut down")
