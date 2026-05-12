"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateCompanySeniatDataAction } from "../actions/company.actions";

type Props = {
  companyId: string;
  initialData: {
    name: string;
    rif: string | null;
    address: string | null;
    telefono: string | null;
    email: string | null;
    ciiu: string | null;
    actividad: string | null;
    isSpecialContributor: boolean;
  };
};

export function CompanySeniatDataForm({ companyId, initialData }: Props) {
  const [form, setForm] = useState({
    name: initialData.name,
    rif: initialData.rif ?? "",
    address: initialData.address ?? "",
    telefono: initialData.telefono ?? "",
    email: initialData.email ?? "",
    ciiu: initialData.ciiu ?? "",
    actividad: initialData.actividad ?? "",
    isSpecialContributor: initialData.isSpecialContributor,
  });

  const [isPending, startTransition] = useTransition();

  function handleChange(field: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateCompanySeniatDataAction({
        companyId,
        name: form.name,
        rif: form.rif || undefined,
        address: form.address || undefined,
        telefono: form.telefono || undefined,
        email: form.email || undefined,
        ciiu: form.ciiu || undefined,
        actividad: form.actividad || undefined,
        isSpecialContributor: form.isSpecialContributor,
      });

      if (result.success) {
        toast.success("Datos fiscales actualizados correctamente");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="grid gap-4">
      {/* Fila 1: Razón Social + RIF */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="seniat-name">Razón Social</Label>
          <Input
            id="seniat-name"
            value={form.name}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder="Empresa Demo, C.A."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="seniat-rif">RIF</Label>
          <Input
            id="seniat-rif"
            value={form.rif}
            onChange={(e) => handleChange("rif", e.target.value)}
            placeholder="J-12345678-9"
          />
          <p className="text-muted-foreground text-xs">Formato: J-12345678-9</p>
        </div>
      </div>

      {/* Fila 2: Teléfono + Email */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="seniat-telefono">Teléfono</Label>
          <Input
            id="seniat-telefono"
            value={form.telefono}
            onChange={(e) => handleChange("telefono", e.target.value)}
            placeholder="0212-555-0000"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="seniat-email">Email de Contacto</Label>
          <Input
            id="seniat-email"
            type="email"
            value={form.email}
            onChange={(e) => handleChange("email", e.target.value)}
            placeholder="contabilidad@empresa.com"
          />
        </div>
      </div>

      {/* Fila 3: Dirección */}
      <div className="grid gap-1.5">
        <Label htmlFor="seniat-address">Dirección Fiscal</Label>
        <Input
          id="seniat-address"
          value={form.address}
          onChange={(e) => handleChange("address", e.target.value)}
          placeholder="Av. Principal, Edificio X, Piso 3, Caracas, Miranda"
        />
      </div>

      {/* Fila 4: CIIU + Actividad */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="seniat-ciiu">Código CIIU</Label>
          <Input
            id="seniat-ciiu"
            value={form.ciiu}
            onChange={(e) => handleChange("ciiu", e.target.value)}
            placeholder="G4711"
          />
          <p className="text-muted-foreground text-xs">Clasificación Industrial CIIU Rev.4</p>
        </div>
        <div className="col-span-2 grid gap-1.5">
          <Label htmlFor="seniat-actividad">Actividad Económica Principal</Label>
          <Input
            id="seniat-actividad"
            value={form.actividad}
            onChange={(e) => handleChange("actividad", e.target.value)}
            placeholder="Comercialización de equipos de computación"
          />
        </div>
      </div>

      {/* Fila 5: Tipo de Contribuyente */}
      <div className="grid gap-1.5 w-64">
        <Label htmlFor="seniat-taxpayer-type">Tipo de Contribuyente</Label>
        <Select
          value={form.isSpecialContributor ? "especial" : "ordinario"}
          onValueChange={(v) => handleChange("isSpecialContributor", v === "especial")}
        >
          <SelectTrigger id="seniat-taxpayer-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ordinario">Contribuyente Ordinario</SelectItem>
            <SelectItem value="especial">Contribuyente Especial</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          {form.isSpecialContributor
            ? "Retiene IVA a proveedores (75% / 100%) y declara mensualmente"
            : "Declara IVA mensualmente sin retenciones obligatorias"}
        </p>
      </div>

      <div className="pt-2">
        <Button onClick={handleSave} disabled={isPending} size="sm">
          {isPending && <Loader2Icon className="animate-spin" />}
          {isPending ? "Guardando..." : "Guardar datos fiscales"}
        </Button>
      </div>
    </div>
  );
}
