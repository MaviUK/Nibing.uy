import React from "react"

const areas = [
  ["Bangor", "https://nibing.uy/bin-cleaning-bangor/"],
  ["Groomsport", "https://nibing.uy/bin-cleaning-groomsport"],
  ["Donaghadee", "https://nibing.uy/bin-cleaning-donaghadee"],
  ["Newtownards", "https://nibing.uy/bin-cleaning-newtownards"],
  ["Greyabbey", "https://nibing.uy/bin-cleaning-greyabbey"],
  ["Comber", "https://nibing.uy/bin-cleaning-comber"],
  ["Millisle", "https://nibing.uy/bin-cleaning-millisle"],
  ["Ballywalter", "https://nibing.uy/bin-cleaning-ballywalter"],
  ["Portaferry", "https://nibing.uy/bin-cleaning-portaferry"],
  ["Portavogie", "https://nibing.uy/bin-cleaning-portavogie"],
  ["Cloughey", "https://nibing.uy/bin-cleaning-cloughey"],
  ["Ballyhalbert", "https://nibing.uy/bin-cleaning-ballyhalbert"],
]

const graph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://nibing.uy/#website",
      url: "https://nibing.uy/",
      name: "NI Bin Guy",
      publisher: { "@id": "https://nibing.uy/#localbusiness" },
      inLanguage: "en-GB",
    },
    {
      "@type": "WebPage",
      "@id": "https://nibing.uy/#webpage",
      url: "https://nibing.uy/",
      name: "NI Bin Guy | Domestic & Commercial Bin Cleaning",
      isPartOf: { "@id": "https://nibing.uy/#website" },
      about: { "@id": "https://nibing.uy/#localbusiness" },
      mainEntity: { "@id": "https://nibing.uy/#localbusiness" },
      inLanguage: "en-GB",
    },
    {
      "@type": "Service",
      "@id": "https://nibing.uy/#domestic-bin-cleaning",
      name: "Domestic Wheelie Bin Cleaning",
      serviceType: "Domestic wheelie bin cleaning",
      description: "Regular 4-weekly and one-off wheelie bin cleaning for households, including washing, sanitising and deodorising.",
      provider: { "@id": "https://nibing.uy/#localbusiness" },
      areaServed: areas.map(([name]) => ({ "@type": "Place", name })),
      offers: [
        {
          "@type": "Offer",
          name: "Regular domestic wheelie bin cleaning",
          price: "5.00",
          priceCurrency: "GBP",
          description: "Regular domestic bin cleaning starts from GBP 5 per bin.",
        },
        {
          "@type": "Offer",
          name: "One-off domestic wheelie bin cleaning",
          price: "15.00",
          priceCurrency: "GBP",
          description: "One-off domestic bin cleaning starts from GBP 15.",
        },
      ],
    },
    {
      "@type": "Service",
      "@id": "https://nibing.uy/#commercial-bin-cleaning",
      name: "Commercial Bin Cleaning",
      serviceType: "Commercial bin cleaning",
      description: "Commercial bin cleaning for businesses and organisations, including larger 360L, 660L and 1100L bins by arrangement.",
      provider: { "@id": "https://nibing.uy/#localbusiness" },
      areaServed: areas.map(([name]) => ({ "@type": "Place", name })),
      audience: {
        "@type": "BusinessAudience",
        audienceType: "Businesses and organisations using commercial waste bins",
      },
    },
    {
      "@type": "ItemList",
      "@id": "https://nibing.uy/#service-areas",
      name: "NI Bin Guy Service Areas",
      itemListElement: areas.map(([name, url], index) => ({
        "@type": "ListItem",
        position: index + 1,
        name,
        url,
      })),
    },
  ],
}

export default function HomepageServiceSchema() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  )
}
