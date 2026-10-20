import type {
  Itinerary,
  Landuse,
  Location,
  Scenario,
  Species,
  SpeciesSource,
  SpeciesSpec,
} from './stores/structures'

const student: Species = {
  type: 'student',
  itinerary: [
    {
      duration: 6,
      variability: 2,
      targets: [{ landuseKey: 'university', proportion: 0.8 }],
    },
  ],
  money: 10,
  urgency: 5,
}

const landuses: Landuse[] = [
  {
    type: 'university',
    location: {
      lng: 1,
      lat: 1,
    },
    attraction: 100,
    hours: [9, 5],
  },
]

const scenario: Scenario = {
  name: 'demo',
  sources: [
    {
      location: {
        lng: 1,
        lat: 1,
      },
      speciesSpecs: [
        {
          species: student,
          count: 200,
        },
      ],
    },
  ],
  landuses,
}
