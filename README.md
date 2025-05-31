# RSS Feed Generator

Smart RSS Feed Generator - Tự động tạo RSS feeds cho các website không có RSS.

## Tính năng

- Tự động tạo RSS feed từ bất kỳ website nào
- Hỗ trợ nhiều loại website khác nhau
- Cập nhật feed tự động theo lịch
- API RESTful để quản lý feeds
- Rate limiting và bảo mật
- Logging và monitoring

## Yêu cầu

- Node.js >= 16.0.0
- npm >= 8.0.0
- PostgreSQL >= 13
- Redis >= 6

## Cài đặt

1. Clone repository:
```bash
git clone https://github.com/your-username/rss-feed-generator.git
cd rss-feed-generator
```

2. Cài đặt dependencies:
```bash
npm install
```

3. Tạo file `.env` từ `.env.example` và cấu hình các biến môi trường:
```bash
cp .env.example .env
```

4. Khởi tạo database:
```bash
npm run db:init
```

5. Chạy migrations:
```bash
npm run db:migrate
```

## Sử dụng

1. Khởi động server:
```bash
# Development
npm run dev

# Production
npm start
```

2. API Endpoints:

- `POST /api/generate-feed`: Tạo RSS feed từ website URL
- `GET /api/feeds/:feedId`: Truy cập nội dung RSS feed
- `GET /api/feed-info/:feedId`: Lấy thông tin về feed
- `DELETE /api/feeds/:feedId`: Xóa feed
- `GET /api/feeds`: Liệt kê tất cả feeds
- `GET /health`: Kiểm tra trạng thái server
- `GET /health/detailed`: Kiểm tra chi tiết trạng thái server

## Development

1. Chạy tests:
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

2. Linting:
```bash
# Check linting
npm run lint

# Fix linting issues
npm run lint:fix
```

## Contributing

1. Fork repository
2. Tạo branch mới (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add some amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Tạo Pull Request

## License

MIT License - Xem file [LICENSE](LICENSE) để biết thêm chi tiết. 