import { Camera, UploadCloud } from "lucide-react";

import { PackLogForm } from "@/components/logging/pack-log-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LogPackPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Pack Logging</h1>
        <p className="mt-2 text-white/65">
          Log packs manually or upload a photo and let RipSense AI detect pulls for you.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4 text-[--accent-blue]" />
              AI Pull Recognition
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-white/70">
            <p>1. Upload image</p>
            <p>2. Vision detects cards</p>
            <p>3. Match with Pokemon database</p>
            <p>4. Confirm confidence + market values</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="flex h-full items-center justify-between p-6">
            <div>
              <p className="text-sm text-white/60">Upload flow optimized for mobile logging</p>
              <p className="mt-1 text-lg font-semibold">Large tap targets and fast image processing</p>
            </div>
            <Badge variant="gold">
              <UploadCloud className="mr-1 h-3.5 w-3.5" />
              Phone-first UX
            </Badge>
          </CardContent>
        </Card>
      </div>

      <PackLogForm />
    </div>
  );
}
