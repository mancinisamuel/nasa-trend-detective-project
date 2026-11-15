"""Lange Abrufe abbrechen, wenn der Client die Verbindung trennt.

uvicorn/Starlette cancelt den Handler bei einem Disconnect nicht von selbst; ohne das liefen
die Zellabrufe eines verlassenen Requests (usa: rund 3900) im Server weiter.
"""

import asyncio
from collections.abc import Coroutine, Iterable
from typing import Any

from starlette.requests import ClientDisconnect, Request

DISCONNECT_POLL_SECONDS = 1.0


async def cancel_on_disconnect[T](request: Request, work: Coroutine[Any, Any, T]) -> T:
    """work als Task ausführen; trennt der Client, Task canceln und ClientDisconnect werfen."""
    task = asyncio.ensure_future(work)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=DISCONNECT_POLL_SECONDS)
            if done:
                return task.result()
            if await request.is_disconnected():
                raise ClientDisconnect()
    finally:
        # Auch wenn der Handler selbst gecancelt wird: keine verwaisten Abrufe.
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


async def gather_or_cancel[T](work: Iterable[Coroutine[Any, Any, T]]) -> list[T]:
    """Wie gather, aber ein Fehler (oder Cancel von außen) bricht alle übrigen Abrufe ab.

    Wirft den ersten Fehler selbst, nicht als ExceptionGroup, damit ApiError (504, 502 ...)
    wie bisher beim Client ankommt.
    """
    try:
        async with asyncio.TaskGroup() as group:
            tasks = [group.create_task(item) for item in work]
    except BaseExceptionGroup as errors:
        raise errors.exceptions[0] from None
    return [task.result() for task in tasks]
