"""F2 — Konkurensi engine: lock + isolasi counter per namespace (dokumen).

Regresi untuk bug F2: worker FastAPI berbagi singleton RulesEngine;
kunci lama `pump_id:trouble` membuat dua dokumen kapasitas sama
saling menaikkan counter. Kunci kini `namespace:pump:trouble` + `Lock`.
"""

import threading
from datetime import timedelta

from .conftest import make_reading


def test_trigger_counter_exact_under_threads(engine):
    # CT raksasa agar cap tak menyembunyikan lost-update: hasil harus persis.
    per_ns_threads, iters = 4, 250
    total_threads = per_ns_threads * 2
    ct = total_threads * iters + 100
    barrier = threading.Barrier(total_threads)

    def hammer(ns: str):
        barrier.wait(timeout=30)
        for _ in range(iters):
            engine._update_trigger_counter(5000, "TURBULENSI", True, ct, ns)

    threads = [
        threading.Thread(target=hammer, args=(f"site:{i % 2}",))
        for i in range(total_threads)
    ]
    for th in threads:
        th.start()
    for th in threads:
        th.join(timeout=60)
    assert not any(th.is_alive() for th in threads)
    assert engine.get_trigger_counter(5000, "TURBULENSI", "site:0") == per_ns_threads * iters
    assert engine.get_trigger_counter(5000, "TURBULENSI", "site:1") == per_ns_threads * iters
    # Namespace lain + namespace legacy kosong tak tersentuh.
    assert engine.get_trigger_counter(5000, "TURBULENSI", "site:2") == 0
    assert engine.get_trigger_counter(5000, "TURBULENSI") == 0


def test_trigger_counter_reset_concurrent(engine):
    engine._update_trigger_counter(5000, "DRY_RUN", True, 5, "site:A")
    engine._update_trigger_counter(5000, "DRY_RUN", False, 5, "site:A")
    assert engine.get_trigger_counter(5000, "DRY_RUN", "site:A") == 0


def test_concurrent_classify_namespaces(engine, pump_5000, setpoint_40, base_ts):
    errors: list[BaseException] = []

    def work(ns: str):
        try:
            for i in range(20):
                r = make_reading(
                    base_ts + timedelta(seconds=i),
                    motor_current=100.0,
                    output_frequency=40.0,
                    output_power=300.0,
                    motor_torque=80.0,
                )
                engine.classify([r], pump_5000, setpoint_40, trigger_namespace=ns)
        except BaseException as exc:  # noqa: BLE001 — dikumpulkan lalu diasert
            errors.append(exc)

    threads = [threading.Thread(target=work, args=(f"site:{s}",)) for s in ("A", "B", "C", "D")]
    for th in threads:
        th.start()
    for th in threads:
        th.join(timeout=120)
    assert not any(th.is_alive() for th in threads)
    assert errors == []
