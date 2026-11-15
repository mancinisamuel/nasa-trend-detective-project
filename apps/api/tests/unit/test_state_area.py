"""Bundesland als flächengewichtetes Mittel der POWER-Rasterzellen (B-STATEAREA)."""

import pytest

from trend_detective.domain import geometry as geo
from trend_detective.domain.power_grid import LAT_STEP, LON_STEP, grid_cells


def test_clipping_concave_polygon_with_hole() -> None:
    # L-Form (Fläche 3) mit Loch 0.2 x 0.2 bei (0.4..0.6, 0.4..0.6).
    outer = [(0.0, 0.0), (2.0, 0.0), (2.0, 1.0), (1.0, 1.0), (1.0, 2.0), (0.0, 2.0), (0.0, 0.0)]
    hole = [(0.4, 0.4), (0.6, 0.4), (0.6, 0.6), (0.4, 0.6), (0.4, 0.4)]
    shape: geo.MultiPolygon = [[outer, hole]]
    assert geo.clipped_area(shape, geo.BBox(0.5, 0.5, 1.5, 1.5)) == pytest.approx(0.75 - 0.01)
    assert geo.clipped_area(shape, geo.BBox(1.5, 1.5, 3.0, 3.0)) == 0.0
    assert geo.clipped_area(shape, geo.BBox(-1, -1, 3, 3)) == pytest.approx(geo.area(shape))


def test_small_polygon_has_few_cells_and_weights_sum_to_one() -> None:
    # Etwa Wien: 16.2-16.5 °E, 48.1-48.3 °N.
    vienna: geo.MultiPolygon = [
        [[(16.2, 48.1), (16.5, 48.1), (16.5, 48.3), (16.2, 48.3), (16.2, 48.1)]]
    ]
    cells = grid_cells(vienna)
    assert [(c.latitude, c.longitude) for c in cells] == [(48.0, 16.25), (48.5, 16.25)]
    assert sum(c.weight for c in cells) == pytest.approx(1.0)
    assert cells[0].weight > cells[1].weight


def test_weights_sum_to_one_for_larger_polygon_on_grid() -> None:
    triangle: geo.MultiPolygon = [[[(14.0, 47.0), (16.9, 47.1), (15.0, 48.9), (14.0, 47.0)]]]
    cells = grid_cells(triangle)
    assert len(cells) > 4
    assert sum(c.weight for c in cells) == pytest.approx(1.0)
    for cell in cells:
        assert (cell.latitude + 90) / LAT_STEP == pytest.approx(
            round((cell.latitude + 90) / LAT_STEP)
        )
        assert (cell.longitude + 180) / LON_STEP == pytest.approx(
            round((cell.longitude + 180) / LON_STEP)
        )


async def test_failing_cell_cancels_running_and_queued_cell_requests() -> None:
    """Eine Zelle scheitert: laufende Abrufe werden gecancelt, wartende nie gestartet."""
    import asyncio

    from trend_detective.api.cancel import gather_or_cancel
    from trend_detective.api.errors import ApiError, provider_timeout

    slots = asyncio.Semaphore(2)  # wie PowerProvider: höchstens 2 gleichzeitig
    started: list[int] = []
    cancelled: list[int] = []

    async def cell(index: int) -> int:
        async with slots:
            started.append(index)
            if index == 0:
                await asyncio.sleep(0.01)
                raise provider_timeout("NASA POWER did not respond in time")
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                cancelled.append(index)
                raise
            return index

    with pytest.raises(ApiError) as info:
        await asyncio.wait_for(gather_or_cancel(cell(i) for i in range(10)), timeout=5)
    assert info.value.status_code == 504
    # Der frei gewordene Slot kann noch eine Zelle anlaufen lassen, danach startet keine mehr.
    assert started[:2] == [0, 1]
    assert len(started) <= 3
    assert sorted(cancelled) == started[1:]
