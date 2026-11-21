"use client";
import { useParams } from "next/navigation";
import { VersionDetail } from "@/components/version-detail";

export default function VersionPage() {
  const { packageId } = useParams<{ packageId: string }>();
  return <VersionDetail packageId={packageId} />;
}
