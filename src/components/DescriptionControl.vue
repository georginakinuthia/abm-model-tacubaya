<script setup>
import { ChevronCircleDown20Regular } from '@vicons/fluent'
import { AccordionContent, AccordionHeader, AccordionItem, AccordionTrigger } from 'reka-ui'
</script>

<template>
  <AccordionItem value="overview" class="accordion-item">
    <AccordionHeader class="border-grey/20 border-b">
      <AccordionTrigger class="accordion-trigger group">
        <span class="accordion-trigger-text">Overview</span>
        <ChevronCircleDown20Regular class="accordion-trigger-icon" />
      </AccordionTrigger>
    </AccordionHeader>
    <AccordionContent class="accordion-content">
      <div class="accordion-child">
        <div class="description-text">
          <h3 class="description-heading">Mode</h3>
          <p class="description-paragraph">
            Governs how agents allocate time. Shopping sets the probability that an agent
            stops at a stall; Resting sets the equivalent probability for street furniture.
            Both activities are suppressed in crowded conditions so that movement through
            congestion takes priority.
          </p>

          <h3 class="description-heading">Movement</h3>
          <p class="description-paragraph">
            Governs how agents navigate. Weather toggles shade-seeking in route choice. Path
            Randomness varies how closely agents follow utility-optimal routes. Personal
            Space sets the minimum comfortable separation between agents. Walking Speed sets
            the free-flow pace before crowd effects take hold.
          </p>

          <h3 class="description-heading">Spawn</h3>
          <p class="description-paragraph">
            Sets pedestrian arrival rates (persons per hour) at each entry point.
          </p>

          <h3 class="description-heading">Technical</h3>
          <p class="description-paragraph mb-0">
            Outlines the underlying model: discrete-choice route selection, density-dependent
            speed adaptation, and reciprocal collision avoidance.
          </p>
        </div>
      </div>
    </AccordionContent>
  </AccordionItem>
</template>
