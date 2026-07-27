<script setup lang="ts">
type AmapRouteStep = { text: string; kind?: string }
type AmapPlaceItem = { name: string; address?: string; distance_m?: number; map_url?: string | null }
export type UiCard =
  | {
      type: 'amap_route'
      title?: string
      origin?: string
      destination?: string
      mode_label?: string
      duration_minutes?: number
      distance_km?: number
      steps?: AmapRouteStep[]
      map_url?: string | null
    }
  | {
      type: 'amap_places'
      title?: string
      subtitle?: string
      places?: AmapPlaceItem[]
    }
  | {
      type: 'amap_address'
      title?: string
      address?: string
      location?: string
      map_url?: string | null
    }

defineProps<{ cards: UiCard[] }>()

function stepIcon(kind?: string) {
  switch (kind) {
    case 'walk':
      return '🚶'
    case 'transit':
      return '🚇'
    case 'bike':
      return '🚲'
    case 'drive':
      return '🚗'
    default:
      return '•'
  }
}
</script>

<template>
  <div v-if="cards.length" class="amap-reply-cards">
    <article
      v-for="(card, ci) in cards"
      :key="ci"
      class="amap-card"
      :class="{
        'amap-card--route': card.type === 'amap_route',
        'amap-card--places': card.type === 'amap_places',
        'amap-card--address': card.type === 'amap_address',
      }"
    >
      <template v-if="card.type === 'amap_route'">
        <header class="amap-card__head">
          <div class="amap-card__title-row">
            <span class="amap-card__badge">高德</span>
            <h4 class="amap-card__title">{{ card.title || '出行路线' }}</h4>
          </div>
          <p class="amap-card__route-endpoints">
            <span>{{ card.origin || '起点' }}</span>
            <span class="amap-card__arrow" aria-hidden="true">→</span>
            <span>{{ card.destination || '终点' }}</span>
          </p>
        </header>
        <div class="amap-card__stats">
          <span v-if="card.duration_minutes != null" class="amap-stat-pill">
            <span class="amap-stat-pill__label">预计</span>
            <span class="amap-stat-pill__value">{{ card.duration_minutes }} 分钟</span>
          </span>
          <span v-if="card.distance_km != null" class="amap-stat-pill">
            <span class="amap-stat-pill__label">距离</span>
            <span class="amap-stat-pill__value">{{ card.distance_km }} 公里</span>
          </span>
          <span v-if="card.mode_label" class="amap-stat-pill">
            <span class="amap-stat-pill__label">方式</span>
            <span class="amap-stat-pill__value">{{ card.mode_label }}</span>
          </span>
        </div>
        <ol v-if="card.steps?.length" class="amap-route-steps">
          <li v-for="(step, si) in card.steps" :key="si" class="amap-route-step">
            <span class="amap-route-step__icon" aria-hidden="true">{{ stepIcon(step.kind) }}</span>
            <span class="amap-route-step__text">{{ step.text }}</span>
          </li>
        </ol>
        <footer v-if="card.map_url" class="amap-card__foot">
          <a class="amap-map-link" :href="card.map_url" target="_blank" rel="noopener noreferrer">在高德地图中打开导航 →</a>
          <span class="amap-card__hint">数据来自高德 Web 服务 · 个人开发者有日免费额度</span>
        </footer>
      </template>

      <template v-else-if="card.type === 'amap_places'">
        <header class="amap-card__head">
          <div class="amap-card__title-row">
            <span class="amap-card__badge">高德</span>
            <h4 class="amap-card__title">{{ card.title || '地点' }}</h4>
          </div>
          <p v-if="card.subtitle" class="amap-card__subtitle">{{ card.subtitle }}</p>
        </header>
        <ul class="amap-place-list">
          <li v-for="(place, pi) in card.places || []" :key="pi" class="amap-place-item">
            <div class="amap-place-item__main">
              <span class="amap-place-item__index">{{ pi + 1 }}</span>
              <div class="amap-place-item__body">
                <div class="amap-place-item__name">{{ place.name }}</div>
                <div v-if="place.address" class="amap-place-item__addr">{{ place.address }}</div>
              </div>
              <span v-if="place.distance_m != null" class="amap-place-item__dist">{{ place.distance_m }}m</span>
            </div>
            <a
              v-if="place.map_url"
              class="amap-place-item__link"
              :href="place.map_url"
              target="_blank"
              rel="noopener noreferrer"
            >查看地图</a>
          </li>
        </ul>
      </template>

      <template v-else-if="card.type === 'amap_address'">
        <header class="amap-card__head">
          <div class="amap-card__title-row">
            <span class="amap-card__badge">高德</span>
            <h4 class="amap-card__title">{{ card.title || '地址' }}</h4>
          </div>
        </header>
        <p class="amap-address-text">{{ card.address || '—' }}</p>
        <p v-if="card.location" class="amap-address-coord">坐标 {{ card.location }}</p>
        <footer v-if="card.map_url" class="amap-card__foot">
          <a class="amap-map-link" :href="card.map_url" target="_blank" rel="noopener noreferrer">在高德地图中查看 →</a>
        </footer>
      </template>
    </article>
  </div>
</template>
