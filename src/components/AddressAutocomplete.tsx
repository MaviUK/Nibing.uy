import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (val: string) => void;
  onPlace?: (place: google.maps.places.PlaceResult) => void;
  placeholder?: string;
  className?: string;
};

export default function AddressAutocomplete({
  value,
  onChange,
  onPlace,
  placeholder = "Start typing your address...",
  className = ""
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autoRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    // Wait until Google script is loaded
    if (!window.google || !window.google.maps || !inputRef.current) return;

    // Create Autocomplete (addresses only, GB)
    autoRef.current = new google.maps.places.Autocomplete(inputRef.current!, {
      types: ["address"],
      componentRestrictions: { country: ["gb"] },
      fields: ["formatted_address", "address_components", "geometry"],
    });

    autoRef.current.addListener("place_changed", () => {
      const place = autoRef.current!.getPlace();
      const formatted = place.formatted_address ?? "";
      onChange(formatted);
      onPlace?.(place);
    });

    return () => {
      // @ts-ignore – no official removeListener on instance; GC will clean up
      autoRef.current = null;
    };
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      type="text"
      autoComplete="street-address"
    />
  );
}
