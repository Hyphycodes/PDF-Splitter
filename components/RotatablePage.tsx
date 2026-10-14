"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  alt: string;
  /** clockwise rotation (0/90/180/270). Changes animate along the shortest turn. */
  rotation: number;
  className?: string;
  /** extra classes for the <img> (e.g. paper shadow) */
  imgClassName?: string;
  /** breathing room (px) kept between the page and the stage edge */
  padding?: number;
}

const norm = (deg: number) => (((deg % 360) + 360) % 360);

/** Signed shortest turn (-180..180] from `from` to `to`, both normalized. */
function shortestDelta(from: number, to: number) {
  const d = ((to - from + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/**
 * A page image that always fits its stage, however it's turned. `rotate()` alone
 * doesn't change layout, so a sideways page would overflow its box; this scales the
 * turned page to fit and animates rotation + scale together so quarter-turns glide
 * (and 270° → 0° keeps spinning the same way instead of unwinding).
 */
export default function RotatablePage({ src, alt, rotation, className = "", imgClassName = "", padding = 8 }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [turn, setTurn] = useState({ last: norm(rotation), angle: norm(rotation) });

  // Unwrapped angle: accumulate the shortest delta so CSS always tweens the short way round.
  const target = norm(rotation);
  if (turn.last !== target) setTurn({ last: target, angle: turn.angle + shortestDelta(turn.last, target) });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sideways = target === 90 || target === 270;
  let scale = 1;
  if (natural && stage.w > 0 && stage.h > 0) {
    const availW = Math.max(stage.w - padding * 2, 1);
    const availH = Math.max(stage.h - padding * 2, 1);
    const fitW = sideways ? natural.h : natural.w;
    const fitH = sideways ? natural.w : natural.h;
    scale = Math.min(availW / fitW, availH / fitH);
  }
  const ready = !!natural && stage.w > 0;

  // Only start tweening a frame after the first placement, so the page doesn't swoop in from scale 1.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [ready]);

  return (
    <div ref={stageRef} className={`relative overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={{
          width: natural?.w,
          height: natural?.h,
          transform: `translate(-50%, -50%) rotate(${turn.angle}deg) scale(${scale})`,
          opacity: ready ? 1 : 0,
        }}
        className={`absolute left-1/2 top-1/2 max-w-none select-none bg-white ${
          animate ? "transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]" : ""
        } ${imgClassName}`}
      />
    </div>
  );
}
