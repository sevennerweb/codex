import type { ReactNode } from "react";

type ReservationCardProps = {
  icon: string;
  eyebrow: string;
  title: string;
  meta: string;
  detail?: ReactNode;
  actions?: ReactNode;
  tone?: "flight" | "train" | "stay";
};

export function ReservationCard({
  icon,
  eyebrow,
  title,
  meta,
  detail,
  actions,
  tone = "flight",
}: ReservationCardProps) {
  return (
    <article className={`reservation-card reservation-${tone}`}>
      <span className="reservation-icon" aria-hidden="true">{icon}</span>
      <div className="reservation-body">
        <span className="reservation-eyebrow">{eyebrow}</span>
        <strong>{title}</strong>
        <p>{meta}</p>
        {detail ? <div className="reservation-detail">{detail}</div> : null}
      </div>
      {actions ? <div className="reservation-actions">{actions}</div> : null}
    </article>
  );
}
